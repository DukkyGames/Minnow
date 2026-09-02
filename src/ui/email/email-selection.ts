export const EMAIL_DRAG_MIME = 'application/x-minnow-email-threads';

/** Payload carried while dragging conversations onto a rail folder. */
export interface EmailDragPayload {
  accountId: string;
  sourceFolder: string;
  threadIds: string[];
}

/** Mutable selection bookkeeping for one inbox mount. */
export interface EmailSelectionState {
  /** Selected conversation ids on the current page (and any still-valid leftovers). */
  selected: Set<string>;
  /** Anchor for Shift-click range selection. */
  anchorId: string | null;
  /** True when every conversation in the folder/view (not just this page) is selected. */
  allInFolder?: boolean;
  /** Total conversations in the folder when `allInFolder` is true. */
  folderTotal?: number;
}

// ── Selection state ──────────────────────────────────────────────────────────

/** Create an empty selection state. */
export function createEmailSelection(): EmailSelectionState {
  return { selected: new Set(), anchorId: null };
}

/** Clear every selected id and the shift anchor. */
export function clearEmailSelection(state: EmailSelectionState): void {
  state.selected.clear();
  state.anchorId = null;
  state.allInFolder = false;
  state.folderTotal = undefined;
}

/** Drop selected ids that are no longer on the current page (or result set). */
export function pruneEmailSelection(
  state: EmailSelectionState,
  validIds: Iterable<string>,
): boolean {
  const valid = new Set(validIds);
  let changed = false;
  for (const id of [...state.selected]) {
    if (valid.has(id)) continue;
    state.selected.delete(id);
    changed = true;
  }
  if (state.anchorId && !valid.has(state.anchorId)) {
    state.anchorId = null;
    changed = true;
  }
  return changed;
}

/** Toggle one conversation. */
export function toggleEmailSelection(
  state: EmailSelectionState,
  threadId: string,
  options: { additive?: boolean } = {},
): void {
  const id = String(threadId);
  if (!id) return;

  if (options.additive) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    state.anchorId = id;
    return;
  }

  if (state.selected.size === 1 && state.selected.has(id)) {
    state.selected.clear();
    state.anchorId = null;
    return;
  }

  state.selected.clear();
  state.selected.add(id);
  state.anchorId = id;
}

/** Select every conversation currently loaded on the page. */
export function selectEmailPage(state: EmailSelectionState, pageIds: string[]): void {
  state.selected.clear();
  for (const id of pageIds) {
    if (id) state.selected.add(id);
  }
  state.anchorId = pageIds[pageIds.length - 1] ?? null;
  state.allInFolder = false;
  state.folderTotal = undefined;
}

/** Select every conversation in the folder/view (all pages). */
export function selectEmailFolder(
  state: EmailSelectionState,
  threadIds: string[],
  folderTotal: number,
): void {
  state.selected.clear();
  for (const id of threadIds) {
    if (id) state.selected.add(id);
  }
  state.anchorId = threadIds[threadIds.length - 1] ?? null;
  state.allInFolder = true;
  state.folderTotal = folderTotal;
}

/** Count label for the toolbar when folder-wide selection is active. */
export function selectionDisplayCount(state: EmailSelectionState): number {
  if (state.allInFolder && state.folderTotal != null) return state.folderTotal;
  return state.selected.size;
}

/** Offer expanding page selection to the whole folder/view. */
export function shouldOfferFolderSelect(
  state: EmailSelectionState,
  pageIds: string[],
  folderTotal: number,
): boolean {
  if (state.allInFolder) return false;
  if (folderTotal <= pageIds.length) return false;
  return masterCheckboxState(state.selected, pageIds) === 'all';
}

// ── Range select ─────────────────────────────────────────────────────────────

/** Shift-click: select the contiguous range from the anchor to the target using page order. */
export function selectEmailShiftRange(
  state: EmailSelectionState,
  pageIds: string[],
  targetId: string,
): void {
  const target = String(targetId);
  if (!target) return;

  const anchor = state.anchorId && pageIds.includes(state.anchorId) ? state.anchorId : target;
  const start = pageIds.indexOf(anchor);
  const end = pageIds.indexOf(target);
  if (start < 0 || end < 0) {
    toggleEmailSelection(state, target, { additive: true });
    return;
  }

  const from = Math.min(start, end);
  const to = Math.max(start, end);
  state.selected.clear();
  for (let i = from; i <= to; i += 1) {
    state.selected.add(pageIds[i]!);
  }
  state.anchorId = anchor;
}

/** Tri-state for the master checkbox over the current page. */
export function masterCheckboxState(
  selected: Set<string>,
  pageIds: string[],
): 'none' | 'some' | 'all' {
  if (pageIds.length === 0) return 'none';
  let hit = 0;
  for (const id of pageIds) {
    if (selected.has(id)) hit += 1;
  }
  if (hit === 0) return 'none';
  if (hit === pageIds.length) return 'all';
  return 'some';
}

/** Which conversations a context-menu / toolbar action should hit. */
export function resolveActionTargetIds(
  selected: Set<string>,
  rowId: string,
): string[] {
  const id = String(rowId);
  if (selected.has(id)) return [...selected];
  return id ? [id] : [];
}

/** Which conversations a drag should move. */
export function resolveDragThreadIds(selected: Set<string>, rowId: string): string[] {
  return resolveActionTargetIds(selected, rowId);
}

// ── Drag payload ─────────────────────────────────────────────────────────────

/** Encode a private drag payload as JSON text. */
export function encodeEmailDragPayload(payload: EmailDragPayload): string {
  return JSON.stringify({
    accountId: String(payload.accountId ?? ''),
    sourceFolder: String(payload.sourceFolder ?? ''),
    threadIds: (payload.threadIds ?? []).map(String).filter(Boolean),
  });
}

/** Parse and validate a private drag payload; null when malformed. */
export function parseEmailDragPayload(raw: string): EmailDragPayload | null {
  try {
    const data = JSON.parse(String(raw ?? '')) as Partial<EmailDragPayload>;
    const accountId = String(data.accountId ?? '').trim();
    const sourceFolder = String(data.sourceFolder ?? '').trim();
    const threadIds = Array.isArray(data.threadIds)
      ? data.threadIds.map(String).map((id) => id.trim()).filter(Boolean)
      : [];
    if (!accountId || !sourceFolder || threadIds.length === 0) return null;
    return { accountId, sourceFolder, threadIds };
  } catch {
    return null;
  }
}

/** Can this folder accept the drop? */
export function canAcceptEmailDrop(
  payload: EmailDragPayload,
  dest: { accountId: string; folderPath: string },
): boolean {
  if (payload.accountId !== dest.accountId) return false;
  if (!dest.folderPath) return false;
  return payload.sourceFolder !== dest.folderPath;
}

export function selectionReadAction(
  threads: Array<{ threadId: string; unreadCount: number }>,
  selected: Set<string>,
): 'read' | 'unread' {
  for (const thread of threads) {
    if (selected.has(thread.threadId) && thread.unreadCount > 0) return 'read';
  }
  return 'unread';
}

export function selectionStarAction(
  threads: Array<{ threadId: string; flagged: boolean }>,
  selected: Set<string>,
): 'flag' | 'unflag' {
  for (const thread of threads) {
    if (selected.has(thread.threadId) && !thread.flagged) return 'flag';
  }
  return 'unflag';
}

/** Collect folder-scoped message ids for the given thread ids. */
export function collectMessageIdsForThreads(
  threads: Array<{ threadId: string; messageIds?: string[] }>,
  threadIds: Iterable<string>,
): string[] {
  const want = new Set([...threadIds].map(String));
  const ids: string[] = [];
  for (const thread of threads) {
    if (!want.has(thread.threadId)) continue;
    for (const messageId of thread.messageIds ?? []) {
      if (messageId) ids.push(messageId);
    }
  }
  return ids;
}
