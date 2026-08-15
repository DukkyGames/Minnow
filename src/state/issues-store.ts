/**
 * Issues store — persisted in ~/.minnow/issues/state.json (MIN-261).
 * One-time migration from bugs/state.json + localStorage minnow-bugs-v1.
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import {
  normalizeProjectKeyInput,
  parseKeyedIssueId,
  suggestProjectKey,
  validateProjectKey,
} from '../issues/project-key.ts';
import { isServerStorageMode } from '../config/storage-mode.ts';
import { getBugs, getIssues, putIssues } from '../config/api-client.ts';
import {
  defaultIssuePriorityId,
  defaultIssueStatusId,
  defaultIssueTypeId,
  isClosedStatus,
  isKnownIssuePriority,
  isKnownIssueStatus,
  isKnownIssueType,
  openIssueStatusIds,
  requireStatusIdForRole,
  statusIdForRole,
  type IssueStatusRole,
} from '../issues/taxonomy.ts';
import { emitIssuesChange } from './issues-events.ts';
import { getIssuesTaxonomySync } from './issues-taxonomy-store.ts';
import { getWorkspaceLabel, getWorkspacePath } from './workspace.ts';
import type {
  BugCard,
  BugColumn,
  BugSeverity,
  Chat,
  IssueCard,
  IssueCodeRef,
  IssueGitLink,
  IssueIssueRef,
  IssueRelationKind,
  IssuePriority,
  IssueStatus,
  IssueType,
  IssuesState,
  IssuesWorkspaceIdConfig,
} from '../types.ts';

const ISSUES_STORAGE_KEY = 'minnow-issues-v1';
const BUGS_STORAGE_KEY = 'minnow-bugs-v1';

/** Statuses counted as "open" for sidebar badge (derived from taxonomy). */
export function getOpenIssueStatuses(): readonly IssueStatus[] {
  return openIssueStatusIds(getIssuesTaxonomySync());
}

/** @deprecated Use getOpenIssueStatuses() — kept for test imports. */
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = [
  'triage',
  'backlog',
  'todo',
  'planned',
  'in_progress',
  'review',
] as const;

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
  return isKnownIssueType(getIssuesTaxonomySync(), value);
}

export function isIssueStatus(value: string): value is IssueStatus {
  return isKnownIssueStatus(getIssuesTaxonomySync(), value);
}

export function isIssuePriority(value: string): value is IssuePriority {
  return isKnownIssuePriority(getIssuesTaxonomySync(), value);
}

/** Resolve a workflow role to the current status id. */
export function issueStatusForRole(role: IssueStatusRole): string | undefined {
  return statusIdForRole(getIssuesTaxonomySync(), role);
}

/** Require a workflow role status id (throws when unassigned). */
export function requireIssueStatusForRole(role: IssueStatusRole): string {
  return requireStatusIdForRole(getIssuesTaxonomySync(), role);
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
  return { version: 2, nextId: 1, issues: [], workspaces: {} };
}

function workspaceBasenameFromPath(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** Label shown in Settings (basename or synced workspace label). */
function labelForWorkspacePath(workspacePath: string): string {
  const key = normalizeWorkspacePath(workspacePath);
  if (key && key === normalizeWorkspacePath(getWorkspacePath())) {
    const label = getWorkspaceLabel().trim();
    if (label) return label;
  }
  return workspaceBasenameFromPath(workspacePath);
}

function ensureWorkspacesMap(state: IssuesState): Record<string, IssuesWorkspaceIdConfig> {
  if (!state.workspaces) state.workspaces = {};
  return state.workspaces;
}

function maxIssueNumberForKey(
  issues: IssueCard[],
  workspaceKey: string,
  projectKey: string,
): number {
  const prefix = projectKey.toUpperCase();
  let max = 0;
  for (const issue of issues) {
    if (normalizeWorkspacePath(issue.workspacePath) !== workspaceKey) continue;
    const parsed = parseKeyedIssueId(issue.id);
    if (parsed && parsed.prefix === prefix) {
      max = Math.max(max, parsed.number);
    }
  }
  return max;
}

function reconcileGlobalIssNextId(issues: IssueCard[], floor: number): number {
  let nextId = floor;
  for (const issue of issues) {
    const match = /^ISS-(\d+)$/i.exec(issue.id);
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
  }
  return nextId;
}

function parseWorkspaceIdConfig(raw: unknown): IssuesWorkspaceIdConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<IssuesWorkspaceIdConfig>;
  const projectKey = normalizeProjectKeyInput(
    typeof row.projectKey === 'string' ? row.projectKey : '',
  );
  if (validateProjectKey(projectKey)) return null;
  const nextId =
    typeof row.nextId === 'number' && Number.isFinite(row.nextId) && row.nextId >= 1
      ? Math.floor(row.nextId)
      : 1;
  return { projectKey, nextId };
}

function getOrInitWorkspaceIdConfig(workspacePath: string): IssuesWorkspaceIdConfig {
  const state = requireIssuesState();
  const wsKey = normalizeWorkspacePath(workspacePath);
  const map = ensureWorkspacesMap(state);
  const existing = map[wsKey];
  if (existing) return existing;

  const projectKey = suggestProjectKey(labelForWorkspacePath(workspacePath));
  const nextId = maxIssueNumberForKey(state.issues, wsKey, projectKey) + 1;
  const cfg: IssuesWorkspaceIdConfig = { projectKey, nextId };
  map[wsKey] = cfg;
  touchIssuesStore();
  return cfg;
}

function bumpCountersForExplicitIssueId(id: string, workspacePath: string): void {
  const state = requireIssuesState();
  const iss = /^ISS-(\d+)$/i.exec(id);
  if (iss) {
    state.nextId = Math.max(state.nextId, Number(iss[1]) + 1);
    return;
  }
  const parsed = parseKeyedIssueId(id);
  if (!parsed) return;

  const wsKey = normalizeWorkspacePath(workspacePath);
  const map = ensureWorkspacesMap(state);
  const saved = map[wsKey];
  const activeKey = (
    saved?.projectKey ?? suggestProjectKey(labelForWorkspacePath(workspacePath))
  ).toUpperCase();
  if (parsed.prefix !== activeKey) return;

  if (!saved) {
    map[wsKey] = { projectKey: activeKey, nextId: parsed.number + 1 };
    touchIssuesStore();
    return;
  }
  saved.nextId = Math.max(saved.nextId, parsed.number + 1);
}

function requireIssuesState(): IssuesState {
  if (!issuesState) {
    throw new Error('issuesState is not initialized; call loadIssuesFromStorage() first');
  }
  return issuesState;
}

/** Map legacy bug column → issue status via taxonomy roles. */
export function bugColumnToIssueStatus(column: BugColumn): IssueStatus {
  const taxonomy = getIssuesTaxonomySync();
  switch (column) {
    case 'reported':
      return statusIdForRole(taxonomy, 'triage') ?? defaultIssueStatusId(taxonomy);
    case 'investigating':
      return statusIdForRole(taxonomy, 'in_progress') ?? defaultIssueStatusId(taxonomy);
    case 'planned':
      return statusIdForRole(taxonomy, 'planned') ?? defaultIssueStatusId(taxonomy);
    case 'fixing':
      return statusIdForRole(taxonomy, 'in_progress') ?? defaultIssueStatusId(taxonomy);
    case 'complete':
      return statusIdForRole(taxonomy, 'done') ?? defaultIssueStatusId(taxonomy);
    default:
      return defaultIssueStatusId(taxonomy);
  }
}

/** Map issue status → legacy bug column via taxonomy roles. */
export function issueStatusToBugColumn(status: IssueStatus): BugColumn {
  const taxonomy = getIssuesTaxonomySync();
  const item = taxonomy.statuses.find((s) => s.id === status);
  const role = item?.role;
  switch (role) {
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
  const typeRaw = typeof r.type === 'string' ? r.type.trim() : '';
  const statusRaw = typeof r.status === 'string' ? r.status.trim() : '';
  const priorityRaw = typeof r.priority === 'string' ? r.priority.trim() : '';
  if (!typeRaw || !statusRaw || !priorityRaw) return null;
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
  if (Array.isArray(r.issueRefs)) {
    card.issueRefs = r.issueRefs
      .map((item) => normalizeIssueIssueRef(item as IssueIssueRef | string))
      .filter((ref): ref is IssueIssueRef => ref != null);
  }
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
  const row = raw as {
    version?: number;
    nextId?: number;
    issues?: unknown;
    workspaces?: unknown;
  };
  const version = row.version;
  if ((version !== 1 && version !== 2) || !Array.isArray(row.issues)) {
    return defaultIssuesState();
  }
  const issues: IssueCard[] = [];
  for (const item of row.issues) {
    const card = ensureIssueCardShape(item);
    if (card) issues.push(card);
  }
  const floor =
    typeof row.nextId === 'number' && Number.isFinite(row.nextId) && row.nextId >= 1
      ? Math.floor(row.nextId)
      : 1;
  const nextId = reconcileGlobalIssNextId(issues, floor);

  const workspaces: Record<string, IssuesWorkspaceIdConfig> = {};
  if (row.workspaces && typeof row.workspaces === 'object') {
    for (const [pathKey, cfgRaw] of Object.entries(row.workspaces)) {
      const cfg = parseWorkspaceIdConfig(cfgRaw);
      if (!cfg) continue;
      const wsKey = normalizeWorkspacePath(pathKey);
      const reconciledNext = Math.max(
        cfg.nextId,
        maxIssueNumberForKey(issues, wsKey, cfg.projectKey) + 1,
      );
      workspaces[wsKey] = { projectKey: cfg.projectKey, nextId: reconciledNext };
    }
  }

  return { version: 2, nextId, issues, workspaces };
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
  return { version: 2, nextId, issues, workspaces: {} };
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
      const id = allocateIssueId(
        shaped.workspacePath?.trim() ? shaped.workspacePath : getWorkspacePath(),
      );
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

/** Allocate next KEY-n id for a workspace and bump its counter. */
function allocateIssueId(workspacePath: string): string {
  const wsKey = normalizeWorkspacePath(workspacePath.trim() || getWorkspacePath());
  const cfg = getOrInitWorkspaceIdConfig(wsKey);
  const id = `${cfg.projectKey}-${cfg.nextId}`;
  cfg.nextId += 1;
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
  const id = issueId?.trim() || allocateIssueId(workspacePath);
  bumpCountersForExplicitIssueId(id, workspacePath);
  const taxonomy = getIssuesTaxonomySync();
  const card: IssueCard = {
    id,
    type: input.type ?? defaultIssueTypeId(taxonomy),
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    status: input.status ?? defaultIssueStatusId(taxonomy),
    priority: input.priority ?? defaultIssuePriorityId(taxonomy),
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

/** Quick-capture helper: note in triage role status. */
export function quickCaptureIssue(title: string, workspacePath?: string): IssueCard {
  const taxonomy = getIssuesTaxonomySync();
  return addIssue({
    title,
    description: '',
    type: findNoteTypeId(taxonomy),
    status: defaultIssueStatusId(taxonomy),
    priority: defaultIssuePriorityId(taxonomy),
    workspacePath,
  });
}

function findNoteTypeId(taxonomy: ReturnType<typeof getIssuesTaxonomySync>): IssueType {
  if (isKnownIssueType(taxonomy, 'note')) return 'note';
  return defaultIssueTypeId(taxonomy);
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
  issueRefs?: IssueIssueRef[];
};

const ISSUE_RELATION_KINDS: readonly IssueRelationKind[] = [
  'related',
  'blocks',
  'blocked-by',
  'duplicate-of',
  'parent',
  'sub-issue',
];

/** True when a string is a supported issue-to-issue relation kind. */
export function isIssueRelationKind(value: string): value is IssueRelationKind {
  return (ISSUE_RELATION_KINDS as readonly string[]).includes(value);
}

/** Inverse relation kind written on the target issue when linking bidirectionally. */
export function inverseIssueRelationKind(kind: IssueRelationKind): IssueRelationKind {
  switch (kind) {
    case 'blocks':
      return 'blocked-by';
    case 'blocked-by':
      return 'blocks';
    case 'parent':
      return 'sub-issue';
    case 'sub-issue':
      return 'parent';
    default:
      return kind;
  }
}

/** True when two issue refs point at the same target with the same kind. */
export function issueIssueRefsEqual(a: IssueIssueRef, b: IssueIssueRef): boolean {
  return a.issueId === b.issueId && a.kind === b.kind;
}

/** Normalize an issue-to-issue ref for storage (string ids default to related). */
export function normalizeIssueIssueRef(
  ref: IssueIssueRef | string | Partial<IssueIssueRef>,
  addedAt?: number,
): IssueIssueRef | null {
  if (typeof ref === 'string') {
    const issueId = ref.trim();
    if (!issueId) return null;
    return { issueId, kind: 'related', addedAt: addedAt ?? issuesNowMs() };
  }
  const issueId =
    typeof ref.issueId === 'string'
      ? ref.issueId.trim()
      : typeof (ref as { issue_id?: string }).issue_id === 'string'
        ? (ref as { issue_id: string }).issue_id.trim()
        : '';
  if (!issueId) return null;
  const kindRaw = typeof ref.kind === 'string' ? ref.kind.trim() : 'related';
  if (!isIssueRelationKind(kindRaw)) return null;
  const out: IssueIssueRef = {
    issueId,
    kind: kindRaw,
    addedAt: typeof ref.addedAt === 'number' ? ref.addedAt : addedAt ?? issuesNowMs(),
  };
  if (typeof ref.note === 'string' && ref.note.trim()) {
    out.note = ref.note.trim();
  }
  return out;
}

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
  issueRefs?: IssueIssueRef[];
};

/** Append one normalized issue ref to a card when not already present. */
function appendIssueIssueRefToCard(issue: IssueCard, ref: IssueIssueRef): boolean {
  const existing = issue.issueRefs ? [...issue.issueRefs] : [];
  if (existing.some((entry) => issueIssueRefsEqual(entry, ref))) return false;
  existing.push(ref);
  issue.issueRefs = existing;
  return true;
}

/**
 * Append-only links for issue_link (code refs, git chips, chat id, issue refs).
 * Dedupes identical path/line ranges, kind+ref git links, and issueId+kind issue refs.
 * Issue refs are written bidirectionally with inverse kinds on the target card.
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

  if (links.issueRefs?.length) {
    for (const raw of links.issueRefs) {
      const ref = normalizeIssueIssueRef(raw);
      if (!ref) continue;
      if (ref.issueId === issue.id) continue;
      const target = findIssueById(ref.issueId);
      if (!target) continue;
      const sourceAdded = appendIssueIssueRefToCard(issue, ref);
      const inverseRef: IssueIssueRef = {
        issueId: issue.id,
        kind: inverseIssueRelationKind(ref.kind),
        note: ref.note,
        addedAt: ref.addedAt,
      };
      const targetAdded = appendIssueIssueRefToCard(target, inverseRef);
      if (sourceAdded || targetAdded) {
        changed = true;
        target.updatedAt = issuesNowMs();
      }
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
  if (patch.labels) {
    const seen = new Set<string>();
    issue.labels = [];
    for (const raw of patch.labels) {
      const label = normalizeIssueLabel(raw);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      issue.labels.push(label);
    }
  }
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
  if (patch.issueRefs) {
    issue.issueRefs = patch.issueRefs
      .map((ref) => normalizeIssueIssueRef(ref))
      .filter((ref): ref is IssueIssueRef => ref != null);
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
  const workspaces = state.workspaces
    ? Object.fromEntries(
        Object.entries(state.workspaces).map(([key, cfg]) => [
          key,
          { projectKey: cfg.projectKey, nextId: cfg.nextId },
        ]),
      )
    : {};
  return {
    version: 2,
    nextId: state.nextId,
    issues: state.issues.map((i) => ({ ...i, labels: [...i.labels] })),
    workspaces,
  };
}

/** Saved workspace id config, if any. */
export function getWorkspaceIdConfig(
  workspacePath?: string,
): IssuesWorkspaceIdConfig | undefined {
  const wsKey = normalizeWorkspacePath(workspacePath?.trim() || getWorkspacePath());
  return requireIssuesState().workspaces?.[wsKey];
}

/** Effective project key (saved or suggested from folder name). */
export function getWorkspaceProjectKey(workspacePath?: string): string {
  const wsKey = normalizeWorkspacePath(workspacePath?.trim() || getWorkspacePath());
  const saved = getWorkspaceIdConfig(wsKey);
  if (saved) return saved.projectKey;
  return suggestProjectKey(labelForWorkspacePath(wsKey));
}

/** Preview the next auto-allocated id for a workspace. */
export function getNextIssueIdPreview(workspacePath?: string): string {
  const wsKey = normalizeWorkspacePath(workspacePath?.trim() || getWorkspacePath());
  const key = getWorkspaceProjectKey(wsKey);
  const state = requireIssuesState();
  const saved = state.workspaces?.[wsKey];
  const nextNum =
    saved?.nextId ?? maxIssueNumberForKey(state.issues, wsKey, key) + 1;
  return `${key}-${nextNum}`;
}

/** Count issues stored for one workspace path. */
export function countIssuesInWorkspace(workspacePath: string): number {
  const wsKey = normalizeWorkspacePath(workspacePath);
  return requireIssuesState().issues.filter(
    (issue) => normalizeWorkspacePath(issue.workspacePath) === wsKey,
  ).length;
}

/** Persist a new project key for one workspace (reconciles nextId from existing cards). */
export function setWorkspaceProjectKey(
  workspacePath: string,
  rawKey: string,
): { ok: true } | { ok: false; error: string } {
  const validationError = validateProjectKey(rawKey);
  if (validationError) return { ok: false, error: validationError };
  const projectKey = normalizeProjectKeyInput(rawKey);
  const wsKey = normalizeWorkspacePath(workspacePath);
  const state = requireIssuesState();
  const map = ensureWorkspacesMap(state);
  const nextId = maxIssueNumberForKey(state.issues, wsKey, projectKey) + 1;
  map[wsKey] = { projectKey, nextId };
  touchIssuesStore();
  return { ok: true };
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

/** Trim and collapse whitespace for a single issue label. */
export function normalizeIssueLabel(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

/** Unique label strings used across issues (for autocomplete), case-insensitive dedupe. */
export function collectIssueLabelSuggestions(excludeIssueId?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issue of requireIssuesState().issues) {
    if (excludeIssueId && issue.id === excludeIssueId) continue;
    for (const label of issue.labels) {
      const normalized = normalizeIssueLabel(label);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return out;
}

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
    if (hideDone && isClosedStatus(getIssuesTaxonomySync(), issue.status)) continue;
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
    if (!getOpenIssueStatuses().includes(issue.status)) continue;
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
