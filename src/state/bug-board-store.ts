/**
 * Bug tracker store — persisted in ~/.minnow/bugs/state.json (not on chats).
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import { isServerStorageMode } from '../config/storage-mode.ts';
import { getBugs, putBugs } from '../config/api-client.ts';
import { emitBugsChange } from './bug-board-events.ts';
import { getWorkspacePath } from './workspace.ts';
import type { BugCard, BugColumn, BugSeverity, Chat } from '../types.ts';

const BUGS_STORAGE_KEY = 'minnow-bugs-v1';

/** Persisted bug file shape. */
export type BugsState = {
  version: 1;
  bugs: BugCard[];
};

let bugsState: BugsState | null = null;
let bugsLoaded = false;

/** Injectable clock for deterministic tests. */
let bugBoardNowMs = (): number => Date.now();

/** Override timestamp source in tests. */
export function setBugBoardNowForTests(fn: (() => number) | null): void {
  bugBoardNowMs = fn ?? (() => Date.now());
}

const BUG_COLUMNS: readonly BugColumn[] = [
  'reported',
  'investigating',
  'planned',
  'fixing',
  'complete',
] as const;

const BUG_SEVERITIES = new Set<BugSeverity>(['low', 'medium', 'high', 'critical']);

export function isBugColumn(value: string): value is BugColumn {
  return (BUG_COLUMNS as readonly string[]).includes(value);
}

export function isBugSeverity(value: string): value is BugSeverity {
  return BUG_SEVERITIES.has(value as BugSeverity);
}

/** Workspace-relative default plan path for a bug id. */
export function defaultBugPlanPath(bugId: string): string {
  return `documentation/plans/bugs/${bugId}.md`;
}

function defaultBugsState(): BugsState {
  return { version: 1, bugs: [] };
}

function requireBugsState(): BugsState {
  if (!bugsState) {
    throw new Error('bugsState is not initialized; call loadBugsFromStorage() first');
  }
  return bugsState;
}

function parseBugsState(raw: unknown): BugsState {
  if (!raw || typeof raw !== 'object') return defaultBugsState();
  const row = raw as Partial<BugsState>;
  if (row.version !== 1 || !Array.isArray(row.bugs)) return defaultBugsState();
  const bugs: BugCard[] = [];
  for (const item of row.bugs) {
    const card = ensureBugCardShape(item);
    if (card) bugs.push(card);
  }
  return { version: 1, bugs };
}

function ensureBugCardShape(raw: unknown): BugCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<BugCard>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!id || !title) return null;
  const severityRaw = typeof r.severity === 'string' ? r.severity : 'medium';
  const columnRaw = typeof r.column === 'string' ? r.column : 'reported';
  if (!isBugSeverity(severityRaw) || !isBugColumn(columnRaw)) return null;
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : bugBoardNowMs();
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : createdAt;
  const workspacePath = normalizeWorkspacePath(
    typeof r.workspacePath === 'string' ? r.workspacePath : '',
  );
  const card: BugCard = {
    id,
    title,
    description: typeof r.description === 'string' ? r.description : '',
    severity: severityRaw,
    column: columnRaw,
    workspacePath,
    createdAt,
    updatedAt,
  };
  if (typeof r.notes === 'string') card.notes = r.notes;
  if (typeof r.planPath === 'string' && r.planPath.trim()) card.planPath = r.planPath.trim();
  if (typeof r.chatId === 'string' && r.chatId.trim()) card.chatId = r.chatId.trim();
  if (typeof r.investigateRunId === 'string' && r.investigateRunId.trim()) {
    card.investigateRunId = r.investigateRunId.trim();
  }
  if (typeof r.planRunId === 'string' && r.planRunId.trim()) {
    card.planRunId = r.planRunId.trim();
  }
  if (typeof r.fixRunId === 'string' && r.fixRunId.trim()) {
    card.fixRunId = r.fixRunId.trim();
  }
  return card;
}

function touchBugsStore(): void {
  scheduleSaveBugs();
  emitBugsChange();
  void import('../ui/global-bugs-page.ts').then((m) => m.refreshGlobalBugsSidebarBadge());
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist (~400ms). */
export function scheduleSaveBugs(): void {
  if (!bugsState) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveBugsNow();
  }, 400);
}

/** Immediate persist. */
export async function saveBugsNow(): Promise<void> {
  if (!bugsState) return;
  if (isServerStorageMode()) {
    try {
      await putBugs(bugsState);
    } catch {
      void import('../ui/status.ts').then((m) =>
        m.setStatus('err', 'Could not save bugs to ~/.minnow'),
      );
    }
    return;
  }
  try {
    localStorage.setItem(BUGS_STORAGE_KEY, JSON.stringify(bugsState));
  } catch {
    /* ignore quota */
  }
}

/** Load bugs from API or localStorage. */
export async function loadBugsFromStorage(): Promise<void> {
  if (isServerStorageMode()) {
    try {
      bugsState = parseBugsState(await getBugs());
      bugsLoaded = true;
      return;
    } catch {
      bugsState = defaultBugsState();
      bugsLoaded = true;
      void import('../ui/status.ts').then((m) =>
        m.setStatus('err', 'Could not load bugs from ~/.minnow'),
      );
      return;
    }
  }
  try {
    const raw = localStorage.getItem(BUGS_STORAGE_KEY);
    bugsState = raw ? parseBugsState(JSON.parse(raw)) : defaultBugsState();
  } catch {
    bugsState = defaultBugsState();
  }
  bugsLoaded = true;
}

/** Import legacy chat.bugBoard bugs once, then strip boards from chats. */
export async function migrateBugsFromChats(chats: Chat[]): Promise<void> {
  if (!bugsState) return;
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
      if (findBugById(bug.id)) continue;
      const card = ensureBugCardShape({
        ...bug,
        workspacePath: chat.workspacePath ?? bug.workspacePath ?? '',
        chatId: bug.chatId ?? chat.id,
      });
      if (card) {
        bugsState.bugs.push(card);
        changed = true;
      }
    }
    delete chat.bugBoard;
    changed = true;
  }
  if (changed) {
    await saveBugsNow();
    emitBugsChange();
    const { scheduleSaveSessions } = await import('./sessions.ts');
    scheduleSaveSessions();
  }
}

/** All bugs (read-only copy). */
export function listBugs(): BugCard[] {
  return [...requireBugsState().bugs];
}

/** Find one bug by id. */
export function findBugById(bugId: string): BugCard | undefined {
  return requireBugsState().bugs.find((b) => b.id === bugId);
}

export type AddBugInput = {
  title: string;
  description: string;
  severity: BugSeverity;
  workspacePath?: string;
};

/** Add a bug card in the Reported column. */
export function addBug(input: AddBugInput, bugId: string): BugCard {
  const nowMs = bugBoardNowMs();
  const workspacePath = normalizeWorkspacePath(
    input.workspacePath?.trim() || getWorkspacePath(),
  );
  const card: BugCard = {
    id: bugId,
    title: input.title.trim(),
    description: input.description.trim(),
    severity: input.severity,
    column: 'reported',
    workspacePath,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  requireBugsState().bugs.push(card);
  touchBugsStore();
  return card;
}

export type UpdateBugPatch = {
  column?: BugColumn;
  notes?: string;
  planPath?: string;
  chatId?: string;
  investigateRunId?: string;
  planRunId?: string;
  fixRunId?: string;
};

/** Patch one bug card; returns updated card or null if missing. */
export function updateBug(bugId: string, patch: UpdateBugPatch): BugCard | null {
  const bug = findBugById(bugId);
  if (!bug) return null;
  const nowMs = bugBoardNowMs();
  if (patch.column) bug.column = patch.column;
  if (patch.notes !== undefined) bug.notes = patch.notes;
  if (patch.planPath !== undefined) bug.planPath = patch.planPath;
  if (patch.chatId !== undefined) bug.chatId = patch.chatId;
  if (patch.investigateRunId !== undefined) bug.investigateRunId = patch.investigateRunId;
  if (patch.planRunId !== undefined) bug.planRunId = patch.planRunId;
  if (patch.fixRunId !== undefined) bug.fixRunId = patch.fixRunId;
  bug.updatedAt = nowMs;
  touchBugsStore();
  return bug;
}

/** Serialize all bugs for tools and UI. */
export function getBugsSnapshot(): BugsState {
  const state = requireBugsState();
  return {
    version: 1,
    bugs: state.bugs.map((b) => ({ ...b })),
  };
}

/** Count bugs per column. */
export function countBugsByColumn(): Record<BugColumn, number> {
  const counts: Record<BugColumn, number> = {
    reported: 0,
    investigating: 0,
    planned: 0,
    fixing: 0,
    complete: 0,
  };
  for (const bug of requireBugsState().bugs) {
    counts[bug.column] += 1;
  }
  return counts;
}

/** Test harness: inject in-memory bugs without API. */
export function setBugsStateForTests(state: BugsState | null): void {
  bugsState = state;
  bugsLoaded = state !== null;
}

export function isBugsStoreLoaded(): boolean {
  return bugsLoaded;
}
