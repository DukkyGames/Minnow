/**
 * Issues store — persisted in ~/.minnow/issues/state.json (MIN-261).
 * One-time migration from bugs/state.json + localStorage minnow-bugs-v1.
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import { isServerStorageMode } from '../config/storage-mode.ts';
import { getBugs, getIssues, putIssues } from '../config/api-client.ts';
import { emitIssuesChange } from './issues-events.ts';
import { getWorkspacePath } from './workspace.ts';
import type {
  BugCard,
  BugColumn,
  BugSeverity,
  Chat,
  IssueCard,
  IssueCodeRef,
  IssueGitLink,
  IssuePriority,
  IssueStatus,
  IssueType,
  IssuesState,
} from '../types.ts';

const ISSUES_STORAGE_KEY = 'minnow-issues-v1';
const BUGS_STORAGE_KEY = 'minnow-bugs-v1';

/** Statuses counted as "open" for sidebar badge. */
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = [
  'triage',
  'backlog',
  'todo',
  'planned',
  'in_progress',
  'review',
] as const;

const ISSUE_TYPES = new Set<IssueType>(['bug', 'task', 'idea', 'note']);
const ISSUE_STATUSES = new Set<IssueStatus>([
  'triage',
  'backlog',
  'todo',
  'planned',
  'in_progress',
  'review',
  'done',
  'canceled',
]);
const ISSUE_PRIORITIES = new Set<IssuePriority>([
  'urgent',
  'high',
  'medium',
  'low',
  'none',
]);

/** Legacy bug columns (bug_* aliases + migration). */
const BUG_COLUMNS: readonly BugColumn[] = [
  'reported',
  'investigating',
  'planned',
  'fixing',
  'complete',
] as const;

const BUG_SEVERITIES = new Set<BugSeverity>(['low', 'medium', 'high', 'critical']);

let issuesState: IssuesState | null = null;
let issuesLoaded = false;

/** Injectable clock for deterministic tests. */
let issuesNowMs = (): number => Date.now();

/** Override timestamp source in tests. */
export function setIssuesNowForTests(fn: (() => number) | null): void {
  issuesNowMs = fn ?? (() => Date.now());
}

export function isIssueType(value: string): value is IssueType {
  return ISSUE_TYPES.has(value as IssueType);
}

export function isIssueStatus(value: string): value is IssueStatus {
  return ISSUE_STATUSES.has(value as IssueStatus);
}

export function isIssuePriority(value: string): value is IssuePriority {
  return ISSUE_PRIORITIES.has(value as IssuePriority);
}

/** Type guard for legacy bug_* column values. */
export function isBugColumn(value: string): value is BugColumn {
  return (BUG_COLUMNS as readonly string[]).includes(value);
}

/** Type guard for legacy bug_* severity values. */
export function isBugSeverity(value: string): value is BugSeverity {
  return BUG_SEVERITIES.has(value as BugSeverity);
}

/** Workspace-relative default plan path for an issue id. */
export function defaultIssuePlanPath(issueId: string): string {
  return `documentation/plans/issues/${issueId}.md`;
}

function defaultIssuesState(): IssuesState {
  return { version: 1, nextId: 1, issues: [] };
}

function requireIssuesState(): IssuesState {
  if (!issuesState) {
    throw new Error('issuesState is not initialized; call loadIssuesFromStorage() first');
  }
  return issuesState;
}

/** Map legacy bug column → issue status. */
export function bugColumnToIssueStatus(column: BugColumn): IssueStatus {
  switch (column) {
    case 'reported':
      return 'triage';
    case 'investigating':
      return 'in_progress';
    case 'planned':
      return 'planned';
    case 'fixing':
      return 'in_progress';
    case 'complete':
      return 'done';
    default:
      return 'triage';
  }
}

/** Map issue status → legacy bug column (for bug_* alias tools). */
export function issueStatusToBugColumn(status: IssueStatus): BugColumn {
  switch (status) {
    case 'triage':
    case 'backlog':
    case 'todo':
      return 'reported';
    case 'planned':
      return 'planned';
    case 'in_progress':
    case 'review':
      return 'fixing';
    case 'done':
    case 'canceled':
      return 'complete';
    default:
      return 'reported';
  }
}

/** Map bug severity → issue priority. */
export function bugSeverityToIssuePriority(severity: BugSeverity): IssuePriority {
  switch (severity) {
    case 'critical':
      return 'urgent';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'medium';
  }
}

/** Map issue priority → nearest bug severity (for bug_* alias tools). */
export function issuePriorityToBugSeverity(priority: IssuePriority): BugSeverity {
  switch (priority) {
    case 'urgent':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
    case 'none':
      return 'low';
    default:
      return 'medium';
  }
}

function ensureIssueCardShape(raw: unknown): IssueCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<IssueCard>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!id || !title) return null;
  const typeRaw = typeof r.type === 'string' ? r.type : 'task';
  const statusRaw = typeof r.status === 'string' ? r.status : 'triage';
  const priorityRaw = typeof r.priority === 'string' ? r.priority : 'none';
  if (!isIssueType(typeRaw) || !isIssueStatus(statusRaw) || !isIssuePriority(priorityRaw)) {
    return null;
  }
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : issuesNowMs();
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : createdAt;
  const workspacePath = normalizeWorkspacePath(
    typeof r.workspacePath === 'string' ? r.workspacePath : '',
  );
  const labels = Array.isArray(r.labels)
    ? r.labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim())
    : [];

  const card: IssueCard = {
    id,
    type: typeRaw,
    title,
    description: typeof r.description === 'string' ? r.description : '',
    status: statusRaw,
    priority: priorityRaw,
    labels,
    workspacePath,
    createdAt,
    updatedAt,
  };

  if (Array.isArray(r.codeRefs)) card.codeRefs = r.codeRefs as IssueCard['codeRefs'];
  if (Array.isArray(r.gitLinks)) card.gitLinks = r.gitLinks as IssueCard['gitLinks'];
  if (Array.isArray(r.chatIds)) {
    card.chatIds = r.chatIds.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  }
  if (typeof r.planPath === 'string' && r.planPath.trim()) card.planPath = r.planPath.trim();
  if (typeof r.boardChatId === 'string' && r.boardChatId.trim()) {
    card.boardChatId = r.boardChatId.trim();
  }
  if (typeof r.investigateRunId === 'string' && r.investigateRunId.trim()) {
    card.investigateRunId = r.investigateRunId.trim();
  }
  if (typeof r.planRunId === 'string' && r.planRunId.trim()) {
    card.planRunId = r.planRunId.trim();
  }
  if (typeof r.notes === 'string') card.notes = r.notes;
  if (typeof r.legacyBugId === 'string' && r.legacyBugId.trim()) {
    card.legacyBugId = r.legacyBugId.trim();
  }
  if (
    typeof r.severity === 'string' &&
    (r.severity === 'low' ||
      r.severity === 'medium' ||
      r.severity === 'high' ||
      r.severity === 'critical')
  ) {
    card.severity = r.severity;
  }
  return card;
}

function parseIssuesState(raw: unknown): IssuesState {
  if (!raw || typeof raw !== 'object') return defaultIssuesState();
  const row = raw as Partial<IssuesState>;
  if (row.version !== 1 || !Array.isArray(row.issues)) return defaultIssuesState();
  const issues: IssueCard[] = [];
  for (const item of row.issues) {
    const card = ensureIssueCardShape(item);
    if (card) issues.push(card);
  }
  const nextId =
    typeof row.nextId === 'number' && Number.isFinite(row.nextId) && row.nextId >= 1
      ? Math.floor(row.nextId)
      : Math.max(1, ...issues.map((i) => {
          const m = /^ISS-(\d+)$/.exec(i.id);
          return m ? Number(m[1]) + 1 : 1;
        }));
  return { version: 1, nextId, issues };
}

/** Convert one BugCard into an IssueCard with sequential ISS-n id. */
export function migrateBugCardToIssue(bug: BugCard, issueId: string): IssueCard {
  const chatIds = bug.chatId?.trim() ? [bug.chatId.trim()] : undefined;
  const card: IssueCard = {
    id: issueId,
    type: 'bug',
    title: bug.title,
    description: bug.description ?? '',
    status: bugColumnToIssueStatus(bug.column),
    priority: bugSeverityToIssuePriority(bug.severity),
    labels: [],
    workspacePath: normalizeWorkspacePath(bug.workspacePath ?? ''),
    createdAt: bug.createdAt,
    updatedAt: bug.updatedAt,
    legacyBugId: bug.id,
    severity: bug.severity,
  };
  if (chatIds) card.chatIds = chatIds;
  if (typeof bug.notes === 'string') card.notes = bug.notes;
  if (typeof bug.planPath === 'string' && bug.planPath.trim()) card.planPath = bug.planPath.trim();
  if (typeof bug.investigateRunId === 'string' && bug.investigateRunId.trim()) {
    card.investigateRunId = bug.investigateRunId.trim();
  }
  if (typeof bug.planRunId === 'string' && bug.planRunId.trim()) {
    card.planRunId = bug.planRunId.trim();
  }
  // fixRunId is an orchestrate run id; store as boardChatId only when it looks like a chat id.
  if (typeof bug.fixRunId === 'string' && bug.fixRunId.trim()) {
    card.boardChatId = bug.fixRunId.trim();
  }
  return card;
}

function parseBugsArray(raw: unknown): BugCard[] {
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as { bugs?: unknown };
  if (!Array.isArray(row.bugs)) return [];
  const out: BugCard[] = [];
  for (const item of row.bugs) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Partial<BugCard>;
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!id || !title) continue;
    const severity = b.severity;
    const column = b.column;
    if (
      severity !== 'low' &&
      severity !== 'medium' &&
      severity !== 'high' &&
      severity !== 'critical'
    ) {
      continue;
    }
    if (
      column !== 'reported' &&
      column !== 'investigating' &&
      column !== 'planned' &&
      column !== 'fixing' &&
      column !== 'complete'
    ) {
      continue;
    }
    out.push({
      id,
      title,
      description: typeof b.description === 'string' ? b.description : '',
      severity,
      column,
      workspacePath: normalizeWorkspacePath(
        typeof b.workspacePath === 'string' ? b.workspacePath : '',
      ),
      createdAt: typeof b.createdAt === 'number' ? b.createdAt : issuesNowMs(),
      updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : issuesNowMs(),
      ...(typeof b.chatId === 'string' ? { chatId: b.chatId } : {}),
      ...(typeof b.notes === 'string' ? { notes: b.notes } : {}),
      ...(typeof b.planPath === 'string' ? { planPath: b.planPath } : {}),
      ...(typeof b.investigateRunId === 'string'
        ? { investigateRunId: b.investigateRunId }
        : {}),
      ...(typeof b.planRunId === 'string' ? { planRunId: b.planRunId } : {}),
      ...(typeof b.fixRunId === 'string' ? { fixRunId: b.fixRunId } : {}),
    });
  }
  return out;
}

/** Build IssuesState from bug cards (does not persist). */
export function migrateBugsToIssuesState(bugs: BugCard[]): IssuesState {
  const issues: IssueCard[] = [];
  let nextId = 1;
  for (const bug of bugs) {
    const id = `ISS-${nextId}`;
    nextId += 1;
    issues.push(migrateBugCardToIssue(bug, id));
  }
  return { version: 1, nextId, issues };
}

async function loadBugsForMigration(): Promise<BugCard[]> {
  if (isServerStorageMode()) {
    try {
      const bugsState = await getBugs();
      return parseBugsArray(bugsState);
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    const raw = localStorage.getItem(BUGS_STORAGE_KEY);
    if (!raw) return [];
    return parseBugsArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

function touchIssuesStore(): void {
  scheduleSaveIssues();
  emitIssuesChange();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist (~400ms). */
export function scheduleSaveIssues(): void {
  if (!issuesState) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveIssuesNow();
  }, 400);
}

/** Immediate persist. */
export async function saveIssuesNow(): Promise<void> {
  if (!issuesState) return;
  if (isServerStorageMode()) {
    try {
      await putIssues(issuesState);
    } catch {
      void import('../ui/status.ts').then((m) =>
        m.setStatus('err', 'Could not save issues to ~/.minnow'),
      );
    }
    return;
  }
  try {
    localStorage.setItem(ISSUES_STORAGE_KEY, JSON.stringify(issuesState));
  } catch {
    /* ignore quota */
  }
}

/**
 * Import leftover `chat.bugBoard` cards into Issues (by legacyBugId), then strip boards.
 * Safe to call after loadIssuesFromStorage — does not rewrite bugs/state.json.
 * @returns true when chats or issues were mutated (caller should persist sessions).
 */
export async function migrateLegacyBugBoardsFromChats(chats: Chat[]): Promise<boolean> {
  if (!issuesLoaded || !issuesState) return false;
  const state = issuesState;
  let changed = false;
  for (const chat of chats) {
    const legacy = chat.bugBoard?.bugs;
    if (!legacy?.length) {
      if (chat.bugBoard) {
        delete chat.bugBoard;
        changed = true;
      }
      continue;
    }
    for (const bug of legacy) {
      const shaped = parseBugsArray({ bugs: [bug] })[0];
      if (!shaped) continue;
      // Prefer workspace from the owning chat when the card omitted it.
      if (!shaped.workspacePath && chat.workspacePath) {
        shaped.workspacePath = normalizeWorkspacePath(chat.workspacePath);
      }
      if (!shaped.chatId) shaped.chatId = chat.id;
      if (findIssueById(shaped.id)) continue;
      const id = allocateIssueId();
      state.issues.push(migrateBugCardToIssue(shaped, id));
      changed = true;
    }
    delete chat.bugBoard;
    changed = true;
  }
  if (!changed) return false;
  await saveIssuesNow();
  emitIssuesChange();
  return true;
}

/**
 * Load issues from API or localStorage.
 * If the issues file/key is absent, migrate from bugs (leaving bugs untouched).
 */
export async function loadIssuesFromStorage(): Promise<void> {
  if (isServerStorageMode()) {
    try {
      const raw = await getIssues();
      if (raw !== null) {
        issuesState = parseIssuesState(raw);
        issuesLoaded = true;
        return;
      }
      // Missing issues resource → one-time migrate from bugs.
      const bugs = await loadBugsForMigration();
      issuesState = migrateBugsToIssuesState(bugs);
      issuesLoaded = true;
      await saveIssuesNow();
      emitIssuesChange();
      return;
    } catch {
      issuesState = defaultIssuesState();
      issuesLoaded = true;
      void import('../ui/status.ts').then((m) =>
        m.setStatus('err', 'Could not load issues from ~/.minnow'),
      );
      return;
    }
  }

  try {
    const raw = localStorage.getItem(ISSUES_STORAGE_KEY);
    if (raw) {
      issuesState = parseIssuesState(JSON.parse(raw));
      issuesLoaded = true;
      return;
    }
    const bugs = await loadBugsForMigration();
    issuesState = migrateBugsToIssuesState(bugs);
    issuesLoaded = true;
    await saveIssuesNow();
    emitIssuesChange();
  } catch {
    issuesState = defaultIssuesState();
    issuesLoaded = true;
  }
}

/** Allocate next sequential ISS-n id and bump counter. */
function allocateIssueId(): string {
  const state = requireIssuesState();
  const id = `ISS-${state.nextId}`;
  state.nextId += 1;
  return id;
}

/** All issues (read-only copy). */
export function listIssues(): IssueCard[] {
  return [...requireIssuesState().issues];
}

/** Find one issue by id (ISS-n) or legacy bug id. */
export function findIssueById(issueId: string): IssueCard | undefined {
  const key = issueId.trim();
  return requireIssuesState().issues.find(
    (i) => i.id === key || i.legacyBugId === key,
  );
}

export type AddIssueInput = {
  title: string;
  description?: string;
  type?: IssueType;
  priority?: IssuePriority;
  status?: IssueStatus;
  labels?: string[];
  workspacePath?: string;
  /** Preserved when migrating / bug_* alias. */
  severity?: BugSeverity;
  legacyBugId?: string;
};

/** Add an issue card (defaults: task / triage / none). */
export function addIssue(input: AddIssueInput, issueId?: string): IssueCard {
  const nowMs = issuesNowMs();
  const workspacePath = normalizeWorkspacePath(
    input.workspacePath?.trim() || getWorkspacePath(),
  );
  const id = issueId?.trim() || allocateIssueId();
  // Keep nextId ahead of any explicit ISS-n so later auto-ids never collide.
  const seq = /^ISS-(\d+)$/.exec(id);
  if (seq) {
    const state = requireIssuesState();
    state.nextId = Math.max(state.nextId, Number(seq[1]) + 1);
  }
  const card: IssueCard = {
    id,
    type: input.type ?? 'task',
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    status: input.status ?? 'triage',
    priority: input.priority ?? 'none',
    labels: input.labels ? [...input.labels] : [],
    workspacePath,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  if (input.severity) card.severity = input.severity;
  if (input.legacyBugId) card.legacyBugId = input.legacyBugId;
  requireIssuesState().issues.push(card);
  touchIssuesStore();
  return card;
}

/** Quick-capture helper: note in triage. */
export function quickCaptureIssue(title: string, workspacePath?: string): IssueCard {
  return addIssue({
    title,
    description: '',
    type: 'note',
    status: 'triage',
    priority: 'none',
    workspacePath,
  });
}

export type UpdateIssuePatch = {
  title?: string;
  description?: string;
  type?: IssueType;
  status?: IssueStatus;
  priority?: IssuePriority;
  labels?: string[];
  notes?: string;
  planPath?: string;
  boardChatId?: string;
  investigateRunId?: string;
  planRunId?: string;
  chatIds?: string[];
  codeRefs?: IssueCodeRef[];
  gitLinks?: IssueGitLink[];
};

/** True when two code refs point at the same path + line range. */
export function issueCodeRefsEqual(a: IssueCodeRef, b: IssueCodeRef): boolean {
  return (
    a.path.replace(/\\/g, '/') === b.path.replace(/\\/g, '/') &&
    (a.startLine ?? null) === (b.startLine ?? null) &&
    (a.endLine ?? null) === (b.endLine ?? null)
  );
}

/** Normalize a code ref for storage (forward slashes, sane line range). */
export function normalizeIssueCodeRef(ref: IssueCodeRef): IssueCodeRef | null {
  const path = ref.path.trim().replace(/\\/g, '/');
  if (!path) return null;
  const out: IssueCodeRef = { path };
  if (typeof ref.startLine === 'number' && Number.isFinite(ref.startLine)) {
    out.startLine = Math.max(1, Math.floor(ref.startLine));
  }
  if (typeof ref.endLine === 'number' && Number.isFinite(ref.endLine)) {
    const start = out.startLine ?? 1;
    out.endLine = Math.max(start, Math.floor(ref.endLine));
  }
  if (typeof ref.snippet === 'string' && ref.snippet.trim()) {
    out.snippet = ref.snippet;
  }
  if (typeof ref.note === 'string' && ref.note.trim()) {
    out.note = ref.note.trim();
  }
  return out;
}

/** Normalize a git link chip for storage. */
export function normalizeIssueGitLink(
  link: Omit<IssueGitLink, 'addedAt'> & { addedAt?: number },
): IssueGitLink | null {
  const kind = link.kind;
  const ref = typeof link.ref === 'string' ? link.ref.trim() : '';
  if (!ref) return null;
  if (kind !== 'commit' && kind !== 'branch' && kind !== 'pr' && kind !== 'github-issue') {
    return null;
  }
  const out: IssueGitLink = {
    kind,
    ref,
    addedAt: typeof link.addedAt === 'number' ? link.addedAt : issuesNowMs(),
  };
  if (typeof link.url === 'string' && link.url.trim()) out.url = link.url.trim();
  if (typeof link.title === 'string' && link.title.trim()) out.title = link.title.trim();
  return out;
}

export type AppendIssueLinksInput = {
  codeRefs?: IssueCodeRef[];
  gitLinks?: Array<Omit<IssueGitLink, 'addedAt'> & { addedAt?: number }>;
  chatId?: string;
};

/**
 * Append-only links for issue_link (code refs, git chips, chat id).
 * Dedupes identical path/line ranges and kind+ref git links.
 */
export function appendIssueLinks(
  issueId: string,
  links: AppendIssueLinksInput,
): IssueCard | null {
  const issue = findIssueById(issueId);
  if (!issue) return null;

  let changed = false;
  if (links.codeRefs?.length) {
    const existing = issue.codeRefs ? [...issue.codeRefs] : [];
    for (const raw of links.codeRefs) {
      const ref = normalizeIssueCodeRef(raw);
      if (!ref) continue;
      if (existing.some((e) => issueCodeRefsEqual(e, ref))) continue;
      existing.push(ref);
      changed = true;
    }
    issue.codeRefs = existing;
  }

  if (links.gitLinks?.length) {
    const existing = issue.gitLinks ? [...issue.gitLinks] : [];
    for (const raw of links.gitLinks) {
      const link = normalizeIssueGitLink(raw);
      if (!link) continue;
      if (existing.some((e) => e.kind === link.kind && e.ref === link.ref)) continue;
      existing.push(link);
      changed = true;
    }
    issue.gitLinks = existing;
  }

  const chatId = links.chatId?.trim();
  if (chatId) {
    const chatIds = issue.chatIds ? [...issue.chatIds] : [];
    if (!chatIds.includes(chatId)) {
      chatIds.push(chatId);
      issue.chatIds = chatIds;
      changed = true;
    }
  }

  if (!changed) {
    // Still return the card so tools can report a no-op success.
    return issue;
  }
  issue.updatedAt = issuesNowMs();
  touchIssuesStore();
  return issue;
}

/** Patch one issue; returns updated card or null if missing. */
export function updateIssue(issueId: string, patch: UpdateIssuePatch): IssueCard | null {
  const issue = findIssueById(issueId);
  if (!issue) return null;
  const nowMs = issuesNowMs();
  if (patch.title !== undefined) issue.title = patch.title.trim();
  if (patch.description !== undefined) issue.description = patch.description;
  if (patch.type) issue.type = patch.type;
  if (patch.status) issue.status = patch.status;
  if (patch.priority) issue.priority = patch.priority;
  if (patch.labels) issue.labels = [...patch.labels];
  if (patch.notes !== undefined) issue.notes = patch.notes;
  if (patch.planPath !== undefined) issue.planPath = patch.planPath;
  if (patch.boardChatId !== undefined) issue.boardChatId = patch.boardChatId;
  if (patch.investigateRunId !== undefined) issue.investigateRunId = patch.investigateRunId;
  if (patch.planRunId !== undefined) issue.planRunId = patch.planRunId;
  if (patch.chatIds) issue.chatIds = [...patch.chatIds];
  if (patch.codeRefs) {
    issue.codeRefs = patch.codeRefs
      .map((r) => normalizeIssueCodeRef(r))
      .filter((r): r is IssueCodeRef => r != null);
  }
  if (patch.gitLinks) {
    issue.gitLinks = patch.gitLinks
      .map((g) => normalizeIssueGitLink(g))
      .filter((g): g is IssueGitLink => g != null);
  }
  issue.updatedAt = nowMs;
  touchIssuesStore();
  return issue;
}

/** True when an issue id matches the card id or legacy bug id. */
function issueMatchesKey(issue: IssueCard, key: string): boolean {
  return issue.id === key || issue.legacyBugId === key;
}

/** Remove one issue by id (ISS-n or legacy bug id). Returns true when removed. */
export function deleteIssue(issueId: string): boolean {
  const key = issueId.trim();
  if (!key) return false;
  const state = requireIssuesState();
  const idx = state.issues.findIndex((issue) => issueMatchesKey(issue, key));
  if (idx < 0) return false;
  state.issues.splice(idx, 1);
  touchIssuesStore();
  return true;
}

/** Remove multiple issues; returns the number removed. */
export function deleteIssues(issueIds: string[]): number {
  const keys = new Set(issueIds.map((id) => id.trim()).filter(Boolean));
  if (keys.size === 0) return 0;
  const state = requireIssuesState();
  const before = state.issues.length;
  state.issues = state.issues.filter((issue) => {
    for (const key of keys) {
      if (issueMatchesKey(issue, key)) return false;
    }
    return true;
  });
  const removed = before - state.issues.length;
  if (removed > 0) touchIssuesStore();
  return removed;
}

/** Serialize all issues for tools and UI. */
export function getIssuesSnapshot(): IssuesState {
  const state = requireIssuesState();
  return {
    version: 1,
    nextId: state.nextId,
    issues: state.issues.map((i) => ({ ...i, labels: [...i.labels] })),
  };
}

export type CollectIssuesOptions = {
  workspacePath?: string;
  scope?: 'all' | 'current_workspace';
  status?: IssueStatus | 'all';
  type?: IssueType | 'all';
  priority?: IssuePriority | 'all';
  label?: string;
  hideDone?: boolean;
  search?: string;
};

/** Filter/sort issues for list + board views. */
export function collectIssues(options: CollectIssuesOptions = {}): IssueCard[] {
  const scope = options.scope ?? 'current_workspace';
  const hideDone = options.hideDone !== false;
  const statusFilter = options.status ?? 'all';
  const typeFilter = options.type ?? 'all';
  const priorityFilter = options.priority ?? 'all';
  const labelFilter = options.label?.trim().toLowerCase() ?? '';
  const search = options.search?.trim().toLowerCase() ?? '';
  const workspaceKey =
    scope === 'current_workspace' && options.workspacePath != null
      ? normalizeWorkspacePath(options.workspacePath)
      : null;

  const out: IssueCard[] = [];
  for (const issue of requireIssuesState().issues) {
    const issueWorkspace = normalizeWorkspacePath(issue.workspacePath ?? '');
    if (workspaceKey !== null && issueWorkspace !== workspaceKey) continue;
    if (hideDone && (issue.status === 'done' || issue.status === 'canceled')) continue;
    if (statusFilter !== 'all' && issue.status !== statusFilter) continue;
    if (typeFilter !== 'all' && issue.type !== typeFilter) continue;
    if (priorityFilter !== 'all' && issue.priority !== priorityFilter) continue;
    if (labelFilter && !issue.labels.some((l) => l.toLowerCase() === labelFilter)) continue;
    if (search) {
      const hay = `${issue.id} ${issue.title} ${issue.description} ${issue.labels.join(' ')}`.toLowerCase();
      if (!hay.includes(search)) continue;
    }
    out.push(issue);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Count open issues for sidebar badge. */
export function countOpenIssues(
  options: Pick<CollectIssuesOptions, 'scope' | 'workspacePath'> = {},
): number {
  const scope = options.scope ?? 'current_workspace';
  const workspaceKey =
    scope === 'current_workspace' && options.workspacePath != null
      ? normalizeWorkspacePath(options.workspacePath)
      : null;
  let n = 0;
  for (const issue of requireIssuesState().issues) {
    if (!OPEN_ISSUE_STATUSES.includes(issue.status)) continue;
    if (workspaceKey !== null) {
      const issueWorkspace = normalizeWorkspacePath(issue.workspacePath ?? '');
      if (issueWorkspace !== workspaceKey) continue;
    }
    n += 1;
  }
  return n;
}

/** Project an issue into legacy BugCard shape (bug_* tool compatibility). */
export function issueToBugCard(issue: IssueCard): BugCard {
  const card: BugCard = {
    id: issue.legacyBugId ?? issue.id,
    title: issue.title,
    description: issue.description,
    severity: issue.severity ?? issuePriorityToBugSeverity(issue.priority),
    column: issueStatusToBugColumn(issue.status),
    workspacePath: issue.workspacePath,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
  if (issue.chatIds?.[0]) card.chatId = issue.chatIds[0];
  if (typeof issue.notes === 'string') card.notes = issue.notes;
  if (issue.planPath) card.planPath = issue.planPath;
  if (issue.investigateRunId) card.investigateRunId = issue.investigateRunId;
  if (issue.planRunId) card.planRunId = issue.planRunId;
  if (issue.boardChatId) card.fixRunId = issue.boardChatId;
  return card;
}

/** Test harness: inject in-memory issues without API. */
export function setIssuesStateForTests(state: IssuesState | null): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  issuesState = state;
  issuesLoaded = state !== null;
}

export function isIssuesStoreLoaded(): boolean {
  return issuesLoaded;
}
