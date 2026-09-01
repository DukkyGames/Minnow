/**
 * P1-E — the Boards surface. Orchestrator V2's view.
 *
 * A **new surface**, not a retrofit of `orchestrate-board.ts`. V1's `BoardTask`
 * carries ~50 fields; V2's `TaskState` carries 17 and deliberately drops the
 * retry counters and the multi-flag leftover autonomy blob that PRD §6 replaces
 * with one enum and one integer. Every V1 site reading a deleted field needs a
 * decision rather than a substitution, and V1's Orchestrate section is additionally
 * wired to planner chats, rails, onboarding and kickoff that V2 removes outright.
 * So this is built beside it and V1 is left alone until Phase 4 deletes it.
 *
 * ## The rule this file exists to keep
 *
 * **Nothing here writes board state.** Every mutation is a POST through
 * `client.ts`, and the screen repaints when — and only when — the engine says so
 * over the stream. A Stop button does not grey the board out; it POSTs, and the
 * board changes when `board.stopped` comes back. That is what makes "the
 * renderer is a view" true rather than aspirational, and it is why there is no
 * local state here beyond which task is expanded and which requests are in
 * flight.
 *
 * ## Phase 9
 *
 * P1-E built the smallest surface that proves the property above — a wave-grouped
 * list, a merge queue, a raw journal. Phase 9 finishes it against what V1's
 * Orchestrate actually did: waves × kanban (P9-B), a per-board model binding
 * (P9-C), attempt transcripts (P9-D), rename and delete (P9-E), the `ob-*`
 * twin-shape vocabulary (P9-F), a finish report (P9-G), and manual abandon
 * (P9-H). **Every one of those is a read, a POST, or new engine surface.** None
 * of them is a renderer-owned write, which is why the rule above still holds.
 *
 * ## What it cannot do yet
 *
 * Merge is the serialized rebase-then-merge queue (P3-C). Final is the static
 * ladder (P3-F); the browser step waits for Phase 5. The end-of-run report is
 * the persisted `report.md` artifact (P3-G). When the run is finished or
 * user-stopped, the report pane replaces the kanban; a session-local Board /
 * Report toggle flips back. Retry POSTs `/rerun` (`board.reopened`).
 * Live agent output arrives as SSE `event: live` from P2-F; this view renders
 * the current tool name on the running task card.
 */

import '../styles/orchestrator-boards.css';
import '../styles/orchestrate-hub.css';
import '../styles/orchestrate-plan-screen.css';

import type { BoardState } from '../../server/orchestrator/core/types';
import { DEFAULT_BOARD_CONCURRENCY } from '../../server/orchestrator/core/derive.js';
import {
  createBoardClient,
  createBoardFromPlan,
  createBoardListClient,
  deleteBoard,
  PlanParseFailure,
  readAttemptTranscript,
  readJournal,
  readBoardReport,
  readTaskFileDiff,
  readTaskFiles,
  type BoardClient,
  type BoardListClient,
  type BoardSummary,
} from './client';
import { withSessionToken } from '../api/session-token';
import {
  renderBoardHeader,
  renderBoardSkeleton,
  renderEngineErrors,
  renderMergeQueue,
  renderTaskList,
  renderTimeline,
  type FileDiffView,
  type TaskFilesView,
  type TranscriptView,
} from './board-render';
import {
  renderBoardReport,
  wantsReportScreen,
} from './board-report';
import {
  renderTaskDetail,
  resetTaskDetailLogUi,
  resetTaskDetailUi,
} from './task-detail';
import {
  discoverOrchestratePlans,
  type DiscoverOrchestratePlansResult,
} from '../chat/plans/list-plans';
import { button, el, empty, pill } from './dom';
import { createIcon } from '../ui/icon';
import {
  attachV2BoardHeaderInstruments,
  detachV2BoardHeaderInstruments,
  teardownV2BoardHeaderInstruments,
} from './board-header-v2';
import { isBoardJournalReasoning } from './board-journal-reasoning';
import { isExecutableOrchestratePlan } from '../chat/plans/plan-path';
import {
  mountPlanPreviewContent,
  readPlanArtifactMarkdown,
} from '../chat/plans/plan-preview';
import { getWorkspaceLabel, getWorkspacePath } from '../state/workspace';

/** UI copy for discoverOrchestratePlans error codes (kept here so V2 does not import V1 picker UI). */
const PLAN_LIST_HINTS: Record<string, string> = {
  server_off: 'Open or restart Minnow to list plans.',
  no_plans_dir: 'No documentation/plans folder in this workspace.',
};

/** Strip documentation/plans/ so the dropdown shows the basename, matching Orchestrate. */
function shortPlanLabel(fullPath: string): string {
  return fullPath.replace(/^documentation\/plans\//, '');
}

/** Ignore stale plan-preview fetches when the select changes quickly. */
let askPlanPreviewRequestId = 0;

async function refreshAskPlanPreview(
  planPath: string,
  elements: { section: HTMLElement; pathChip: HTMLElement; previewMount: HTMLElement },
): Promise<void> {
  const trimmed = planPath.trim();
  if (!trimmed || !isExecutableOrchestratePlan(trimmed)) {
    elements.section.hidden = true;
    elements.pathChip.textContent = '';
    elements.pathChip.removeAttribute('title');
    elements.previewMount.replaceChildren();
    return;
  }

  const requestId = (askPlanPreviewRequestId += 1);
  elements.section.hidden = false;
  elements.pathChip.textContent = shortPlanLabel(trimmed);
  elements.pathChip.title = trimmed;
  elements.previewMount.replaceChildren();
  const loading = el('p', 'orchestrate-hub__plan-preview-loading', 'Loading plan…');
  elements.previewMount.appendChild(loading);

  try {
    const markdown = await readPlanArtifactMarkdown(trimmed);
    if (requestId !== askPlanPreviewRequestId) return;
    mountPlanPreviewContent(elements.previewMount, markdown, { modeId: 'plan' });
  } catch {
    if (requestId !== askPlanPreviewRequestId) return;
    elements.previewMount.replaceChildren();
    elements.previewMount.appendChild(
      el('p', 'orchestrate-plan-screen__preview-empty', 'Could not load plan file.'),
    );
  }
}

export const BOARDS_ROOT_ID = 'orchestratorBoardsRoot';
const CHAT_AREA_CLASS = 'chat-area--orchestrator-boards';
const MAIN_COLUMN_CLASS = 'main-column--orchestrator-boards';

/** How much of the journal the timeline asks for. It is kept in full on disk. */
const TIMELINE_LIMIT = 300;

interface Surface {
  root: HTMLElement;
  listPane: HTMLElement;
  boardPane: HTMLElement;
}

let surface: Surface | null = null;
let list: BoardListClient | null = null;
let client: BoardClient | null = null;
let unsubscribeBoard: (() => void) | null = null;
let unsubscribeList: (() => void) | null = null;

let selectedBoardId: string | null = null;
let selectedTaskId: string | null = null;
let showTimeline = false;
/** Last journal GET, so a live-board repaint does not flash "Loading…" over the log. */
let journalView: {
  boardId: string;
  events: readonly Record<string, unknown>[];
  truncated: boolean;
} | null = null;
/** Manual starts awaiting their answer, so a button can say it is working. */
const pendingTasks = new Set<string>();
/** The last thing that went wrong, shown until the next successful command. */
let notice: { text: string; tone: 'warn' | 'bad' } | null = null;
/** The attempt transcript open in the detail panel — P9-D. */
let transcript: TranscriptView | null = null;
/**
 * The selected task's changed files, read from git at its merge commit.
 *
 * Held here for the same reason the transcript is: it is a read beside the
 * journal, it is keyed to the selection, and nothing folds it.
 */
let taskFiles: TaskFilesView | null = null;
/** Diffs for rows the reader opened, mutable so a fetch can land into the view. */
const fileDiffs = new Map<string, FileDiffView>();
/** Which file rows are open. Kept out of `taskFiles` so a refetch cannot close them. */
const expandedFiles = new Set<string>();
/** Board ids whose delete is awaiting a second click — P9-E. */
const confirmingDelete = new Set<string>();
/** The board id currently being renamed inline, if any — P9-E. */
let renamingBoardId: string | null = null;
/** Persisted P3-G report, keyed by board. Presentation only — never folded. */
const finishReportByBoard = new Map<string, string>();
/** In-flight GET so a paint loop does not stampede the endpoint. */
const finishReportLoads = new Set<string>();
/** Session-local: user chose the kanban over the report. Not journaled. */
const reportDismissed = new Set<string>();

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export function isBoardsViewOpen(): boolean {
  return Boolean(document.getElementById(BOARDS_ROOT_ID));
}

/** Close the live V2 board pane without tearing down the Boards page (MIN-752). */
export function deselectBoardForWorkspaceSwitch(): void {
  if (!isBoardsViewOpen()) return;
  selectBoard(null);
}

/** Re-fetch the workspace-filtered list after a workspace switch (MIN-752). */
export function refreshBoardsViewAfterWorkspaceSwitch(): void {
  if (!isBoardsViewOpen()) return;
  void list?.refresh();
}

export async function openBoardsView(): Promise<void> {
  if (isBoardsViewOpen()) {
    void list?.refresh();
    return;
  }

  const { closeOtherCodeStageViews, stripMainColumnOverlayClasses, notifyCodeStageViewChanged } =
    await import('../ui/main-column-overlay');
  await closeOtherCodeStageViews('boards');

  const area = document.getElementById('chatArea');
  if (!area) return;

  // P9-F: the twin-shape vocabulary — `ob-shell` / `ob-rail` / `ob-main` — the
  // same one Super Plan and Research use. The `ov2-*` classes stay alongside it
  // because they are what Phase 4 leaves standing; the `ob-*` ones are what make
  // this read as the same page family rather than a second invention.
  const root = el('div', 'ov2 ob-shell');
  root.id = BOARDS_ROOT_ID;
  const listPane = el('aside', 'ov2__list ob-rail');
  const boardPane = el('section', 'ov2__board ob-main');
  boardPane.tabIndex = -1;
  root.append(listPane, boardPane);

  area.replaceChildren(root);
  stripMainColumnOverlayClasses();
  area.classList.add(CHAT_AREA_CLASS);
  document.getElementById('mainColumn')?.classList.add(MAIN_COLUMN_CLASS);
  surface = { root, listPane, boardPane };
  document.addEventListener('keydown', onBoardsDocumentKeydown, true);

  list = createBoardListClient();
  unsubscribeList = list.subscribe(() => {
    // A board can vanish from under the selection only if something outside this
    // window removed it; fall back to the list rather than to a blank screen.
    if (selectedBoardId && !list?.getBoards().some((b) => b.boardId === selectedBoardId)) {
      selectBoard(null);
    }
    paintList();
  });
  list.start();

  paintList();
  paintBoard();
  syncRailButton();
  notifyCodeStageViewChanged();
}

export function teardownBoardsView(): void {
  if (typeof document === 'undefined') return;
  document.removeEventListener('keydown', onBoardsDocumentKeydown, true);
  unsubscribeBoard?.();
  unsubscribeBoard = null;
  client?.close();
  client = null;
  unsubscribeList?.();
  unsubscribeList = null;
  list?.stop();
  list = null;

  askPlanPreviewRequestId = 0;
  teardownV2BoardHeaderInstruments();
  document.getElementById(BOARDS_ROOT_ID)?.remove();
  const area = document.getElementById('chatArea');
  area?.classList.remove(CHAT_AREA_CLASS);
  document.getElementById('mainColumn')?.classList.remove(MAIN_COLUMN_CLASS);
  surface = null;
  selectedTaskId = null;
  pendingTasks.clear();
  confirmingDelete.clear();
  renamingBoardId = null;
  clearTaskDetailState();
  notice = null;
  syncRailButton();
}

/** Escape closes the task overlay even when focus is not on the dialog itself. */
function onBoardsDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (!surface || !selectedTaskId) return;
  if (!surface.root.querySelector('.ov2-detail-overlay')) return;
  event.preventDefault();
  selectTaskDetail(null);
}

/**
 * Open or close the task detail overlay and put keyboard focus where the
 * overlay lifecycle expects it (Close on open, task card on close).
 */
function selectTaskDetail(taskId: string | null): void {
  const previous = selectedTaskId;
  selectedTaskId = taskId;
  clearTaskDetailState();
  paintBoard();
  // The diffstat is a git read, so it is asked for once per opened task rather
  // than on every paint. `loadTaskFiles` returns early if it is already loaded.
  if (taskId) void loadTaskFiles(taskId);
  if (taskId === null && previous) {
    surface?.root
      .querySelector<HTMLElement>(`[data-focus-key="task:${CSS.escape(previous)}"]`)
      ?.focus();
    return;
  }
  if (taskId) {
    surface?.root.querySelector<HTMLElement>('[data-focus-key="detail-close"]')?.focus();
  }
}

/**
 * Leave the V2 Boards surface. By default restores the last active chat into
 * `#chatArea` and stamps `#/app/code/chat` so the Chats view-bar control does
 * not leave a blank column (same contract as Overview / Dev Servers).
 */
export async function closeBoardsView(options?: {
  skipNavigate?: boolean;
  restoreChat?: boolean;
}): Promise<void> {
  if (!isBoardsViewOpen()) return;

  teardownBoardsView();

  // Leftover V1 board folders can keep viewMode `board` under the V2 surface.
  // Clear that focus before painting, or renderChatFromHistory redirects back.
  const { dismissActiveBoardView } = await import('../state/chat-groups');
  dismissActiveBoardView();

  const { notifyCodeStageViewChanged } = await import('../ui/main-column-overlay');

  if (!options?.skipNavigate) {
    const { navigateToCodeChatIfCurrentSection } = await import('../os/router');
    // Both hashes open this surface (`showCodeStageSection`).
    navigateToCodeChatIfCurrentSection('boards');
    navigateToCodeChatIfCurrentSection('orchestrate');
  }

  if (options?.restoreChat === false) {
    notifyCodeStageViewChanged();
    return;
  }

  const { sessionState } = await import('../state/sessions');
  const targetId = sessionState?.activeId;
  const chat = targetId ? sessionState?.chats.find((c) => c.id === targetId) : undefined;
  const area = document.getElementById('chatArea');
  if (chat) {
    const { renderChatFromHistory } = await import('../ui/messages');
    renderChatFromHistory(chat);
  } else if (area) {
    area.replaceChildren();
  }

  const { notifyAskQuestionDisplayContextChanged } = await import(
    '../chat/ask-question-display'
  );
  notifyAskQuestionDisplayContextChanged();
  void import('../ui/preview-electron-visibility').then((m) =>
    m.scheduleElectronPreviewHostVisibilitySync(),
  );
  notifyCodeStageViewChanged();
}

function syncRailButton(): void {
  const btn = document.getElementById('btnOrchestrate');
  if (!btn) return;
  const open = isBoardsViewOpen();
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.classList.toggle('icon-btn--active', open);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectBoard(boardId: string | null): void {
  if (boardId === selectedBoardId) return;
  unsubscribeBoard?.();
  unsubscribeBoard = null;
  client?.close();
  client = null;

  selectedBoardId = boardId;
  selectedTaskId = null;
  showTimeline = false;
  journalView = null;
  clearTaskDetailState();
  pendingTasks.clear();
  confirmingDelete.clear();
  renamingBoardId = null;
  notice = null;

  if (boardId) {
    client = createBoardClient(boardId, { openStream });
    // Repaint on every change the engine reports, and on connection changes —
    // the header shows both, and they are not the same thing.
    unsubscribeBoard = client.subscribe(() => paintBoard());
    client.connect();
  }
  paintList();
  paintBoard();
}

/** Select a board after create/launch. Exported so Orchestrate entry can skip a chat. */
export function showBoard(boardId: string): void {
  selectBoard(boardId);
}

/**
 * `EventSource` carries no custom headers, so the per-boot session token goes in
 * the query string — the same thing every other stream in the app does.
 *
 * It lives here rather than in `client.ts` on purpose: the client knows about
 * `/api/boards` and nothing about how this application authenticates, which is
 * what lets it be driven end to end in a test with a plain HTTP reader.
 */
function openStream(url: string): EventSource {
  return new EventSource(withSessionToken(url));
}

// ---------------------------------------------------------------------------
// The board list
// ---------------------------------------------------------------------------

function paintList(): void {
  if (!surface) return;
  const pane = surface.listPane;
  pane.replaceChildren();

  const head = el('div', 'ov2__list-head');
  head.appendChild(el('h1', 'ov2__list-title', 'Boards'));
  head.appendChild(
    button({
      label: 'New board',
      title: 'Create a board from a plan file',
      variant: 'primary',
      onClick: () => openAskPane(),
    }),
  );
  pane.appendChild(head);

  const boards = list?.getBoards() ?? [];
  if (boards.length === 0) {
    pane.appendChild(empty('No boards yet. Pick a plan in the main pane to start one.'));
  } else {
    const items = el('ul', 'ov2__boards');
    for (const board of boards) items.appendChild(renderListItem(board));
    pane.appendChild(items);
  }

  const error = list?.getError();
  if (error) {
    pane.appendChild(el('p', 'ov2__list-error', `Could not refresh the list: ${error.message}`));
  }
}

function renderListItem(board: BoardSummary): HTMLElement {
  // No `ob-row` here: that class pulls V1 padding from `ob-page.css` onto the
  // <li>, nesting a padded button inside a padded row and leaving a dead margin
  // around the selected card (and room for the old text "Delete" label).
  const item = el('li', 'ov2__board-item');
  const btn = el('button', 'ov2__board-btn');
  btn.type = 'button';
  btn.dataset.focusKey = `board:${board.boardId}`;
  if (board.boardId === selectedBoardId) btn.classList.add('is-selected');
  btn.addEventListener('click', () => selectBoard(board.boardId));

  btn.appendChild(el('span', 'ov2__board-name', board.name || board.boardId));
  const meta = el('span', 'ov2__board-meta');
  meta.appendChild(
    pill(
      board.finished ? 'finished' : board.status,
      board.finished ? 'good' : board.status === 'running' ? 'live' : 'neutral',
    ),
  );
  meta.appendChild(el('span', undefined, `${board.taskCount} tasks`));
  if (board.status === 'running') meta.appendChild(el('span', undefined, `N=${board.concurrency}`));
  btn.appendChild(meta);
  item.appendChild(btn);

  // P9-E. Two clicks, and the second one says what it takes with it: the journal
  // is the only record of the run, so "are you sure" has to name what is lost
  // rather than ask an abstract question. Icon-only; confirm stays a trash glyph
  // with danger styling so the row does not reserve space for a text label.
  const confirming = confirmingDelete.has(board.boardId);
  const remove = el('button', `ov2__board-delete${confirming ? ' is-confirming' : ''}`);
  remove.type = 'button';
  remove.dataset.focusKey = `delete:${board.boardId}`;
  const deleteLabel = confirming ? 'Delete the journal too?' : `Delete ${board.boardId}`;
  remove.setAttribute('aria-label', deleteLabel);
  remove.title = confirming
    ? `Deleting ${board.boardId} removes its journal — the only record of what the run did.`
    : deleteLabel;
  remove.appendChild(createIcon('trash', { className: 'ov2__board-delete-icon', size: 12 }));
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!confirming) {
      confirmingDelete.clear();
      confirmingDelete.add(board.boardId);
      paintList();
      return;
    }
    confirmingDelete.delete(board.boardId);
    void commandDeleteBoard(board.boardId);
  });
  item.appendChild(remove);
  return item;
}

/**
 * Delete a board — P9-E.
 *
 * Boards accumulated forever and a typo'd board id was permanent, because
 * `ROUTES` had no delete. The selection falls back to nothing rather than to the
 * next board: silently landing on someone else's run is worse than an empty pane.
 */
async function commandDeleteBoard(boardId: string): Promise<void> {
  try {
    await deleteBoard(boardId);
    if (selectedBoardId === boardId) selectBoard(null);
    await list?.refresh();
    paintList();
  } catch (err) {
    notice = {
      text: `Could not delete ${boardId}: ${err instanceof Error ? err.message : String(err)}`,
      tone: 'bad',
    };
    paintBoard();
  }
}

// ---------------------------------------------------------------------------
// Creating a board
// ---------------------------------------------------------------------------

/**
 * Fill a plan <select> from the workspace list Orchestrate already uses.
 *
 * Exported so the create form can be tested without mounting the whole surface.
 */
export async function fillBoardsPlanSelect(
  sel: HTMLSelectElement,
  hintEl: HTMLElement,
  options: {
    discoverPlans?: () => Promise<DiscoverOrchestratePlansResult>;
  } = {},
): Promise<DiscoverOrchestratePlansResult> {
  const discoverFn = options.discoverPlans ?? discoverOrchestratePlans;
  const { plans, error } = await discoverFn();

  sel.replaceChildren();
  const emptyOpt = el('option');
  emptyOpt.value = '';
  emptyOpt.textContent = 'Select plan…';
  sel.appendChild(emptyOpt);

  for (const planPath of plans) {
    const opt = el('option');
    opt.value = planPath;
    opt.textContent = shortPlanLabel(planPath);
    sel.appendChild(opt);
  }

  // One plan in the workspace is the common Super Plan case — select it so
  // Create is one click rather than a hunt through an otherwise empty control.
  sel.value = !error && plans.length === 1 ? plans[0]! : '';

  hintEl.textContent = '';
  hintEl.classList.add('hidden');
  if (error) {
    hintEl.textContent = PLAN_LIST_HINTS[error] ?? 'Could not load plans.';
    hintEl.classList.remove('hidden');
  } else if (plans.length === 0) {
    hintEl.textContent = 'No plans yet. Use Plan mode or add documentation/plans/.';
    hintEl.classList.remove('hidden');
  }

  return { plans, error };
}

export interface CreateFormHandlers {
  discoverPlans?: () => Promise<DiscoverOrchestratePlansResult>;
  /** Defaults to POST /api/boards. Tests inject a stub that only needs the path. */
  createBoard?: (
    planPath: string,
    options?: { boardId?: string; markdown?: string },
  ) => Promise<{ boardId: string }>;
  onCreated: (boardId: string) => void;
  onCancel: () => void;
}

export interface AskPaneHandlers {
  discoverPlans?: () => Promise<DiscoverOrchestratePlansResult>;
  createBoard?: (
    planPath: string,
    options?: { boardId?: string; markdown?: string },
  ) => Promise<{ boardId: string }>;
  onCreated: (boardId: string) => void;
}

/**
 * V1 Orchestrate hub ask/start pane, wired to V2 `createBoardFromPlan`.
 *
 * Shown in the main column when no board is selected. The rail stays the V2
 * journal list; this pane is only the plan picker, preview, and Open board.
 */
export async function mountBoardsAskPane(
  pane: HTMLElement,
  handlers: AskPaneHandlers,
): Promise<void> {
  const createBoard = handlers.createBoard ?? createBoardFromPlan;
  pane.replaceChildren();

  const wrap = el('div', 'ob-pane--ask');
  const ask = el('div', 'ob-ask');

  ask.appendChild(el('p', 'ob-ask__eyebrow orchestrate-hub__eyebrow', 'Orchestrate'));
  ask.appendChild(el('h1', 'ob-ask__title orchestrate-hub__title', 'Boards & plans'));
  ask.appendChild(
    el(
      'p',
      'ob-ask__lede orchestrate-hub__lede',
      'Run a plan as a board, or resume work already listed in the rail.',
    ),
  );

  const workspaceLine = el('p', 'ob-ask__workspace orchestrate-hub__workspace');
  workspaceLine.id = 'orchestrateHubWorkspace';
  const workspaceLabel = getWorkspaceLabel().trim();
  const workspacePath = getWorkspacePath().trim();
  const workspaceDisplay = workspaceLabel || workspacePath;
  if (workspaceDisplay) {
    workspaceLine.textContent = workspaceDisplay;
    if (workspacePath && workspacePath !== workspaceDisplay) {
      workspaceLine.title = workspacePath;
    }
  } else {
    workspaceLine.classList.add('hidden');
    workspaceLine.setAttribute('aria-hidden', 'true');
  }
  ask.appendChild(workspaceLine);

  const sec = el('span', 'ob-ask__sec hub-strip__label', 'Start from plan');
  sec.id = 'orchestrateHubPlanLabel';

  const workflow = el('section', 'orchestrate-hub__workflow');
  workflow.setAttribute('aria-labelledby', 'orchestrateHubPlanLabel');

  const field = el('div', 'ob-ask__field orchestrate-hub__workflow-body');
  const sel = el('select', 'orchestrate-hub__plan-select') as HTMLSelectElement;
  sel.id = 'orchestrateHubPlanSelect';
  sel.setAttribute('aria-label', 'Orchestrate plan file');
  const loadingOpt = el('option');
  loadingOpt.value = '';
  loadingOpt.textContent = 'Loading plans…';
  sel.appendChild(loadingOpt);
  sel.disabled = true;

  const workflowActions = el('div', 'ob-ask__actions orchestrate-hub__workflow-actions');
  const secondaryActions = el('div', 'orchestrate-hub__workflow-secondary');

  const refreshBtn = el('button', 'orchestrate-hub__plan-refresh', 'Refresh') as HTMLButtonElement;
  refreshBtn.type = 'button';
  refreshBtn.id = 'orchestrateHubPlanRefresh';
  refreshBtn.title = 'Reload plan list from workspace';

  const makePlanBtn = el(
    'button',
    'orchestrate-hub__make-plan-btn',
    'Make a plan',
  ) as HTMLButtonElement;
  makePlanBtn.type = 'button';
  makePlanBtn.id = 'orchestrateHubMakePlan';

  secondaryActions.append(refreshBtn, makePlanBtn);

  const startBtn = el('button', 'orchestrate-hub__start-btn', 'Open board') as HTMLButtonElement;
  startBtn.type = 'button';
  startBtn.id = 'orchestrateHubStartBoard';
  startBtn.disabled = true;

  workflowActions.append(secondaryActions, startBtn);
  field.append(sel, workflowActions);

  const hint = el('p', 'orchestrate-hub__plan-hint hidden');
  hint.id = 'orchestrateHubPlanHint';
  hint.setAttribute('role', 'status');

  const errors = el('div', 'ov2-create__errors');
  errors.id = 'orchestrateBoardsAskErrors';

  const previewSection = el('div', 'orchestrate-hub__plan-preview');
  previewSection.id = 'orchestrateHubPlanPreview';
  previewSection.hidden = true;
  previewSection.setAttribute('aria-live', 'polite');

  const pathChip = el('p', 'orchestrate-plan-screen__path');
  pathChip.id = 'orchestrateHubPlanPreviewPath';

  const previewWrap = el('div', 'orchestrate-plan-screen__preview-wrap');
  const previewMount = el('div', 'orchestrate-plan-screen__preview');
  previewMount.id = 'orchestrateHubPlanPreviewMount';
  previewWrap.appendChild(previewMount);
  previewSection.append(pathChip, previewWrap);

  workflow.append(sec, field, hint, errors, previewSection);
  ask.appendChild(workflow);
  wrap.appendChild(ask);
  pane.appendChild(wrap);

  const previewElements = {
    section: previewSection,
    pathChip,
    previewMount,
  };

  const syncStartDisabled = () => {
    const path = sel.value.trim();
    startBtn.disabled = !path || !isExecutableOrchestratePlan(path);
  };

  const syncPlanPreview = () => {
    void refreshAskPlanPreview(sel.value, previewElements);
  };

  const loadPlans = async () => {
    sel.disabled = true;
    await fillBoardsPlanSelect(sel, hint, {
      ...(handlers.discoverPlans ? { discoverPlans: handlers.discoverPlans } : {}),
    });
    sel.disabled = false;
    syncStartDisabled();
    syncPlanPreview();
  };

  sel.addEventListener('change', () => {
    errors.replaceChildren();
    syncStartDisabled();
    syncPlanPreview();
  });

  refreshBtn.addEventListener('click', () => {
    void loadPlans();
  });

  // Blank Super Plan composer — same as the V1 hub, not the last live run.
  makePlanBtn.addEventListener('click', () => {
    void import('../ui/super-plan-entry').then((m) => m.openSuperPlanScreen({ preferNew: true }));
  });

  startBtn.addEventListener('click', () => {
    const planPath = sel.value.trim();
    if (!planPath || !isExecutableOrchestratePlan(planPath)) return;
    errors.replaceChildren();
    startBtn.disabled = true;
    startBtn.textContent = 'Creating…';
    void createBoard(planPath)
      .then(({ boardId }) => {
        handlers.onCreated(boardId);
      })
      .catch((err: unknown) => {
        errors.replaceChildren(renderCreateError(err));
      })
      .finally(() => {
        startBtn.textContent = 'Open board';
        syncStartDisabled();
      });
  });

  await loadPlans();
  sel.focus();
}

function paintAskErrors(pane: HTMLElement): void {
  const slot = pane.querySelector('#orchestrateBoardsAskErrors');
  if (!(slot instanceof HTMLElement)) return;
  slot.replaceChildren();
  if (!notice) return;
  const line = el('p', `ov2-notice ov2-notice--${notice.tone}`, notice.text);
  line.setAttribute('role', 'status');
  slot.appendChild(line);
}

/** Show the ask/start pane and put the plan picker in focus (rail New board). */
function openAskPane(): void {
  if (!surface) return;
  if (selectedBoardId) {
    selectBoard(null);
  } else {
    paintBoard();
  }
  const sel = document.getElementById('orchestrateHubPlanSelect');
  if (sel instanceof HTMLSelectElement) sel.focus();
}

/**
 * The create form, with the parse errors shown where they belong.
 *
 * Plan intake is a dropdown of workspace plans, not a free-text path: the
 * files already live under documentation/plans/, and typing a relative path
 * was how the first cut missed both the list and the workspace-root read.
 *
 * `parsePlan` returns a line, a column, a message and a hint for every problem —
 * that detail is the entire point of PRD §5's move away from an LLM reading the
 * plan, and collapsing it into "board creation failed" would throw it away.
 */
export async function mountCreateForm(
  pane: HTMLElement,
  handlers: CreateFormHandlers,
): Promise<void> {
  const createBoard = handlers.createBoard ?? createBoardFromPlan;
  pane.replaceChildren();

  const form = el('form', 'ov2-create');
  form.appendChild(el('h2', 'ov2-create__title', 'New board'));
  form.appendChild(
    el(
      'p',
      'ov2-create__hint',
      'The plan is parsed, not interpreted by a model. A plan that does not parse ' +
        'is refused with line numbers rather than turned into a board with tasks missing.',
    ),
  );

  // Refresh sits beside the select, not inside a <label> — a label click would
  // otherwise activate the dropdown as well as the button.
  const pathField = el('div', 'ov2-create__field');
  pathField.appendChild(el('span', undefined, 'Plan'));
  const pathRow = el('div', 'ov2-create__field-row');
  const pathSelect = el('select', 'ov2-create__input');
  pathSelect.required = true;
  pathSelect.setAttribute('aria-label', 'Plan');
  const loadingOpt = el('option');
  loadingOpt.value = '';
  loadingOpt.textContent = 'Loading plans…';
  pathSelect.appendChild(loadingOpt);
  pathSelect.disabled = true;
  pathRow.appendChild(pathSelect);
  pathField.appendChild(pathRow);
  form.appendChild(pathField);

  const pathHint = el('p', 'ov2-create__hint hidden');
  pathHint.setAttribute('role', 'status');
  form.appendChild(pathHint);

  const idLabel = el('label', 'ov2-create__field');
  idLabel.appendChild(el('span', undefined, 'Board id (optional)'));
  const idInput = el('input', 'ov2-create__input');
  idInput.type = 'text';
  idInput.placeholder = 'derived from the plan name';
  idLabel.appendChild(idInput);
  form.appendChild(idLabel);

  const errors = el('div', 'ov2-create__errors');
  form.appendChild(errors);

  const actions = el('div', 'ov2-create__actions');
  const submit = el('button', 'ov2-btn ov2-btn--primary', 'Create');
  submit.type = 'submit';
  submit.disabled = true;
  actions.appendChild(submit);
  actions.appendChild(button({ label: 'Cancel', variant: 'ghost', onClick: handlers.onCancel }));
  form.appendChild(actions);

  const syncSubmitEnabled = () => {
    submit.disabled = !pathSelect.value.trim();
  };

  const loadPlans = async () => {
    pathSelect.disabled = true;
    await fillBoardsPlanSelect(pathSelect, pathHint, {
      ...(handlers.discoverPlans ? { discoverPlans: handlers.discoverPlans } : {}),
    });
    pathSelect.disabled = false;
    syncSubmitEnabled();
  };

  pathRow.appendChild(
    button({
      label: 'Refresh',
      title: 'Reload plan list from the workspace',
      variant: 'ghost',
      onClick: () => void loadPlans(),
    }),
  );

  pathSelect.addEventListener('change', syncSubmitEnabled);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const planPath = pathSelect.value.trim();
    if (!planPath) return;
    errors.replaceChildren();
    submit.disabled = true;
    submit.textContent = 'Creating…';
    void createBoard(planPath, {
      ...(idInput.value.trim() ? { boardId: idInput.value.trim() } : {}),
    })
      .then(({ boardId }) => {
        handlers.onCreated(boardId);
      })
      .catch((err: unknown) => {
        errors.replaceChildren(renderCreateError(err));
      })
      .finally(() => {
        submit.textContent = 'Create';
        syncSubmitEnabled();
      });
  });

  pane.appendChild(form);
  await loadPlans();
  pathSelect.focus();
}

function renderCreateError(err: unknown): HTMLElement {
  if (err instanceof PlanParseFailure) {
    const wrap = el('div', 'ov2-create__parse');
    wrap.appendChild(el('p', 'ov2-create__parse-title', 'The plan does not parse:'));
    const items = el('ul', 'ov2-create__parse-list');
    for (const error of err.errors) {
      const item = el('li', 'ov2-create__parse-item');
      item.appendChild(el('span', 'ov2-create__parse-loc', `line ${error.line}:${error.column}`));
      item.appendChild(el('span', 'ov2-create__parse-msg', error.message));
      if (error.hint) item.appendChild(el('span', 'ov2-create__parse-hint', error.hint));
      items.appendChild(item);
    }
    wrap.appendChild(items);
    return wrap;
  }
  return el('p', 'ov2-create__error', err instanceof Error ? err.message : String(err));
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * What has focus right now, as something a repaint can put it back on — P9-I.
 *
 * The surface calls `replaceChildren` on every frame, so the focused node is
 * destroyed several times a minute on a live board. Restoring by *key* rather
 * than by node identity is what makes that survivable: a card that is still on
 * the board after the repaint gets its focus back, and one that moved column
 * keeps it too, because the key is the task, not the position.
 */
function captureFocus(): { key: string; selectionStart: number | null } | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !surface?.root.contains(active)) return null;
  const key = active.dataset?.focusKey;
  if (!key) return null;
  const input = active as HTMLInputElement;
  return {
    key,
    selectionStart: typeof input.selectionStart === 'number' ? input.selectionStart : null,
  };
}

function restoreFocus(captured: { key: string; selectionStart: number | null } | null): void {
  if (!captured || !surface) return;
  const target = surface.root.querySelector<HTMLElement>(
    `[data-focus-key="${CSS.escape(captured.key)}"]`,
  );
  if (!target) return;
  target.focus();
  if (captured.selectionStart === null) return;
  const input = target as HTMLInputElement;
  try {
    input.setSelectionRange(captured.selectionStart, captured.selectionStart);
  } catch {
    // Not a text input any more. The focus is the part that mattered.
  }
}

function paintBoard(): void {
  if (!surface) return;
  const pane = surface.boardPane;

  if (!selectedBoardId) {
    detachV2BoardHeaderInstruments();
    surface.root.classList.remove('is-detail-open');
    surface.root.querySelector('.ov2-detail-overlay')?.remove();
    pane.classList.add('ov2__board--ask');
    // Keep an in-progress picker (and its preview) across list/notice repaints.
    if (pane.querySelector('.ob-pane--ask')) {
      paintAskErrors(pane);
      return;
    }
    void mountBoardsAskPane(pane, {
      onCreated: (boardId) => {
        pane.classList.remove('ov2__board--ask');
        void list?.refresh();
        selectBoard(boardId);
      },
    });
    return;
  }

  pane.classList.remove('ov2__board--ask');

  const state = client?.getState() ?? null;
  if (!state) {
    detachV2BoardHeaderInstruments();
    surface.root.classList.remove('is-detail-open');
    surface.root.querySelector('.ov2-detail-overlay')?.remove();
    // A skeleton in the board's own shape, not the word "Loading" — P9-I.
    pane.replaceChildren(renderBoardSkeleton());
    return;
  }

  const connected = client?.isConnected() ?? false;
  const scrollTop = pane.scrollTop;
  const focused = captureFocus();
  // The model chip and reasoning strip live outside this wipe — detach first
  // so replaceChildren cannot destroy the open picker.
  detachV2BoardHeaderInstruments();
  pane.replaceChildren();
  pane.appendChild(renderBoardHeader(state, connected, renderControls(state)));
  const headerControls = pane.querySelector('.board-header__controls');
  if (headerControls instanceof HTMLElement) {
    attachV2BoardHeaderInstruments(headerControls, state, {
      setModel: commandSetModel,
      onNeedModel: () => {
        notice = { text: 'Pick a model for this board first.', tone: 'warn' };
        paintBoard();
      },
    });
  }
  const errors = renderEngineErrors(client?.getEngineErrors());
  if (errors) pane.appendChild(errors);
  if (notice) {
    const line = el('p', `ov2-notice ov2-notice--${notice.tone}`, notice.text);
    line.setAttribute('role', 'status');
    pane.appendChild(line);
  }

  const showReport = showingReport(state);
  if (showReport) {
    const cached = selectedBoardId ? (finishReportByBoard.get(selectedBoardId) ?? null) : null;
    if (!cached && selectedBoardId) void loadFinishReport(selectedBoardId);
    pane.appendChild(
      renderBoardReport(state, cached, Boolean(selectedBoardId) && !cached, {
        dismiss: () => {
          if (selectedBoardId) reportDismissed.add(selectedBoardId);
          paintBoard();
        },
        reopen: () => void commandRerun(),
        fixFinal: () => void commandRerun(),
      }),
    );
    pane.scrollTop = scrollTop;
    surface.root.classList.remove('is-detail-open');
    surface.root.querySelector('.ov2-detail-overlay')?.remove();
    restoreFocus(focused);
    return;
  }

  const actions = {
    startTask: (taskId: string) => void commandStartTask(taskId),
    abandonTask: (taskId: string) => void commandAbandonTask(taskId),
    rerun: (taskIds?: string[]) => void commandRerun(taskIds),
    select: (taskId: string | null) => selectTaskDetail(taskId),
    openTranscript: (attemptId: string) => void toggleTranscript(attemptId),
    toggleFileDiff: (path: string) => void toggleFileDiff(path),
    openFile: (path: string) => openTaskFile(path),
  };
  const options = {
    selectedTaskId,
    pendingTaskIds: pendingTasks,
    liveHeadlines: client?.getLiveHeadlines(),
    engineErrors: client?.getEngineErrors(),
    transcript,
    files: taskFilesView(),
  };

  pane.appendChild(renderTaskList(state, actions, options));
  pane.appendChild(renderMergeQueue(state));
  if (showTimeline) {
    pane.appendChild(renderTimelineSection());
    if (journalView?.boardId !== selectedBoardId) void loadTimeline();
  }
  // Repainting from scratch is what keeps the view a pure function of the
  // state; restoring the scroll offset and the focus is what stops that being
  // felt as a keyboard user losing their place every five seconds.
  pane.scrollTop = scrollTop;

  const selected = selectedTaskId ? state.tasks.get(selectedTaskId) : undefined;
  // Cover the whole Boards shell so the dialog can use nearly the full area,
  // not only the short board scrollport beside the rail.
  surface.root.classList.toggle('is-detail-open', Boolean(selected));
  surface.root.querySelector('.ov2-detail-overlay')?.remove();
  if (selected) surface.root.appendChild(renderTaskDetail(state, selected, actions, options));
  syncLogPolling(state);

  restoreFocus(focused);
}

/** Everything the detail panel holds about one task. Cleared when it changes. */
function clearTaskDetailState(): void {
  transcript = null;
  taskFiles = null;
  fileDiffs.clear();
  expandedFiles.clear();
  stopLogPolling();
  resetTaskDetailUi();
}

/**
 * Keep an open log on a *running* attempt current.
 *
 * `event: live` only repaints the board for tool traffic (a repaint per token
 * would be a repaint per token), so a long reasoning block would otherwise sit
 * on screen unchanged until the next tool call. This tops the log up on a slow
 * timer while it is open, and stops the moment the attempt ends or the log is
 * closed: nothing polls unless someone is reading.
 */
const LOG_POLL_MS = 1_200;
let logPollTimer: ReturnType<typeof setInterval> | null = null;

function stopLogPolling(): void {
  if (logPollTimer === null) return;
  clearInterval(logPollTimer);
  logPollTimer = null;
}

function syncLogPolling(state: BoardState): void {
  const attemptId = transcript?.attemptId;
  const task = selectedTaskId ? state.tasks.get(selectedTaskId) : undefined;
  const attempt = attemptId
    ? task?.attempts.find((candidate) => candidate.attemptId === attemptId)
    : undefined;
  // A finished attempt's transcript is final, so there is nothing to poll for.
  const wanted = Boolean(attempt && !attempt.ended);
  if (!wanted) {
    stopLogPolling();
    return;
  }
  if (logPollTimer !== null) return;
  logPollTimer = setInterval(() => {
    if (!transcript || transcript.status === 'loading') return;
    void refreshTranscript(transcript.attemptId);
  }, LOG_POLL_MS);
}

/** Re-read an open transcript in place. No skeleton: the log is already on screen. */
async function refreshTranscript(attemptId: string): Promise<void> {
  const boardId = selectedBoardId;
  if (!boardId) return;
  try {
    const result = await readAttemptTranscript(boardId, attemptId, { limit: 500 });
    if (transcript?.attemptId !== attemptId || boardId !== selectedBoardId) return;
    transcript = { attemptId, status: 'ready', ...result };
    paintBoard();
  } catch {
    // A failed top-up leaves the log as it was. It is a read, and the next tick
    // tries again; replacing readable content with an error would be worse.
  }
}

/** Rebuild the immutable view the panel reads from the mutable maps above. */
function taskFilesView(): TaskFilesView | null {
  if (!taskFiles) return null;
  return { ...taskFiles, diffs: fileDiffs, expanded: expandedFiles };
}

/**
 * What the selected task changed, from git at its merge commit.
 *
 * The journal is not asked and is not written: a diffstat is derivable from the
 * repository, so keeping one on an append-only log would only create a second
 * number that can disagree with the first.
 */
async function loadTaskFiles(taskId: string): Promise<void> {
  const boardId = selectedBoardId;
  if (!boardId) return;
  if (taskFiles?.taskId === taskId && taskFiles.status !== 'error') return;

  taskFiles = {
    taskId,
    status: 'loading',
    source: 'planned',
    files: [],
    additions: 0,
    deletions: 0,
    truncated: false,
    diffs: fileDiffs,
    expanded: expandedFiles,
  };
  paintBoard();
  try {
    const result = await readTaskFiles(boardId, taskId);
    // The reader may have moved on while this was in flight.
    if (selectedTaskId !== taskId || boardId !== selectedBoardId) return;
    taskFiles = { ...taskFiles, ...result, status: 'ready' };
  } catch (err) {
    if (selectedTaskId !== taskId || boardId !== selectedBoardId) return;
    taskFiles = {
      ...taskFiles,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  paintBoard();
}

/**
 * Open, or close, one changed file's diff — the chat file list's own gesture.
 *
 * Patches are fetched per row rather than with the stat list: a task that merged
 * forty files would otherwise pull forty patches to show three.
 */
async function toggleFileDiff(path: string): Promise<void> {
  const boardId = selectedBoardId;
  const taskId = selectedTaskId;
  if (!boardId || !taskId) return;

  if (expandedFiles.has(path)) {
    expandedFiles.delete(path);
    paintBoard();
    return;
  }
  expandedFiles.add(path);
  if (fileDiffs.get(path)?.status === 'ready') {
    paintBoard();
    return;
  }
  fileDiffs.set(path, { status: 'loading', lines: [], truncated: false });
  paintBoard();
  try {
    const result = await readTaskFileDiff(boardId, taskId, path);
    if (selectedTaskId !== taskId || boardId !== selectedBoardId) return;
    fileDiffs.set(
      path,
      result
        ? { status: 'ready', lines: result.lines, truncated: result.truncated }
        : { status: 'ready', lines: [], truncated: false },
    );
  } catch (err) {
    if (selectedTaskId !== taskId || boardId !== selectedBoardId) return;
    fileDiffs.set(path, {
      status: 'error',
      lines: [],
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  paintBoard();
}

/** Jump to a changed file in the editor, the same jump the chat file list makes. */
function openTaskFile(path: string): void {
  void import('../ui/file-viewer').then((m) => m.openFileInViewer(path));
}

/**
 * Load, or close, one attempt's transcript — P9-D.
 *
 * A read and nothing else: transcripts live beside the journal and no part of
 * the board state depends on them, so opening one cannot affect the run.
 */
async function toggleTranscript(attemptId: string): Promise<void> {
  const boardId = selectedBoardId;
  if (!boardId) return;
  if (transcript?.attemptId === attemptId) {
    transcript = null;
    resetTaskDetailLogUi();
    paintBoard();
    return;
  }
  // A different log: forget where the last one was scrolled and what was open.
  resetTaskDetailLogUi();
  transcript = { attemptId, status: 'loading', events: [], truncated: false, capped: false };
  paintBoard();
  try {
    const result = await readAttemptTranscript(boardId, attemptId, { limit: 500 });
    // The user may have moved on while this was in flight.
    if (transcript?.attemptId !== attemptId || boardId !== selectedBoardId) return;
    transcript = { attemptId, status: 'ready', ...result };
  } catch (err) {
    if (transcript?.attemptId !== attemptId || boardId !== selectedBoardId) return;
    transcript = {
      attemptId,
      status: 'error',
      events: [],
      truncated: false,
      capped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  paintBoard();
}

/**
 * Interactive cluster for the V1-shaped board header.
 *
 * Same commands as the old boxed `.ov2-controls` bar (start, stop, concurrency,
 * model, rename, timeline). The chrome is the Orchestrator instrument strip so
 * Boards does not invent a second control vocabulary.
 *
 * `setConcurrency` journals `board.started`, which *starts* a stopped board.
 * That is why N only POSTs while the loop is already running; Start carries N
 * for the first tick.
 */
function renderControls(state: BoardState): HTMLElement {
  const controls = el('div', 'board-header__controls');
  const finished = state.finished;
  const running = state.status === 'running';

  // Slot only — the Orchestrate chip is adopted after paint so a live journal
  // stream cannot remount it (and cannot get stuck on "Loading models…").
  const modelSlot = el('div', 'board-header__model-slot mn-os-mb-model-slot');
  modelSlot.title = state.model
    ? `${state.model.providerId} / ${state.model.id}`
    : 'Unbound: attempts use the Autopilot planner model.';
  controls.appendChild(modelSlot);

  const settings = el('div', 'board-header__settings');
  settings.setAttribute('role', 'group');
  settings.setAttribute('aria-label', 'Run settings');
  settings.appendChild(renderConcurrencyControl(state, finished, running));
  controls.appendChild(settings);

  const rerunInstead = finished;
  const runBtn = el(
    'button',
    running ? 'board-header__run-btn board-header__run-btn--stop' : 'board-header__run-btn',
  );
  runBtn.type = 'button';
  runBtn.disabled = false;
  runBtn.textContent = running ? 'Stop' : rerunInstead ? 'Rerun' : 'Start';
  runBtn.setAttribute(
    'aria-label',
    running ? 'Stop board' : rerunInstead ? 'Rerun failed work' : 'Start board',
  );
  runBtn.title = running
    ? 'Stop the loop. In-flight attempts keep running until they finish; nothing new starts.'
    : rerunInstead
      ? 'Reopen failed tasks (or add a fix task) and start the board again. N comes from the run field.'
      : 'Start the reconcile loop. N=1 is sequential; higher N runs that many agents at once.';
  runBtn.addEventListener('click', () => {
    if (running) void commandStop();
    else if (rerunInstead) void commandRerun();
    else void commandStart(readConcurrencyInput());
  });
  controls.appendChild(runBtn);

  if (wantsReportScreen(state)) {
    const onReport = showingReport(state);
    const toggle = el('button', 'board-btn board-btn--compact board-header__dashboard-toggle');
    toggle.type = 'button';
    toggle.textContent = onReport ? 'Board' : 'Report';
    toggle.title = onReport ? 'Return to the kanban board' : 'Open the run report';
    toggle.setAttribute('aria-label', onReport ? 'Back to board' : 'Open run report');
    toggle.addEventListener('click', () => {
      if (!selectedBoardId) return;
      if (onReport) reportDismissed.add(selectedBoardId);
      else reportDismissed.delete(selectedBoardId);
      paintBoard();
    });
    controls.appendChild(toggle);
  }

  if (!showingReport(state)) {
    const timelineBtn = el('button', 'board-btn board-btn--compact board-timeline-btn');
    timelineBtn.type = 'button';
    timelineBtn.textContent = 'Timeline';
    timelineBtn.title = showTimeline ? 'Hide the journal' : 'Show the journal';
    timelineBtn.setAttribute('aria-pressed', showTimeline ? 'true' : 'false');
    timelineBtn.addEventListener('click', () => {
      showTimeline = !showTimeline;
      paintBoard();
      if (showTimeline) void loadTimeline();
    });
    controls.appendChild(timelineBtn);
  }

  controls.appendChild(renderRenameControl(state));
  return controls;
}

/** Number input labelled "run", matching the Orchestrator concurrency field. */
function renderConcurrencyControl(
  state: BoardState,
  finished: boolean,
  running: boolean,
): HTMLElement {
  const wrap = el('label', 'board-header__concurrency');
  wrap.title =
    'Agents running at once. Each is a model call and a worktree. There is no hard cap; pick what this machine can hold. Changing N while running takes effect on the next tick; in-flight attempts keep going.';

  const label = el('span', 'board-header__field-label', 'run');
  wrap.appendChild(label);

  const input = el('input', 'board-header__concurrency-input');
  input.type = 'number';
  input.min = '1';
  input.max = '64';
  // Pre-start fold is 1; show the product default so the first start journals 2
  // unless the user changed it.
  const shownN =
    state.status === 'created' ? DEFAULT_BOARD_CONCURRENCY : state.concurrency;
  input.value = String(shownN);
  input.setAttribute('aria-label', 'Tasks running at once');
  input.id = 'ov2-concurrency-input';
  input.dataset.focusKey = 'board-concurrency';
  input.disabled = false;
  input.addEventListener('change', () => {
    if (!running || finished) return;
    void commandConcurrency(readConcurrencyInput());
  });
  wrap.appendChild(input);
  return wrap;
}

/**
 * Rename the board — P9-E.
 *
 * A journaled command (`board.renamed`), not a field assignment: it reaches every
 * other open window over the same stream as everything else, and a replay of the
 * journal produces the same name.
 */
function renderRenameControl(state: BoardState): HTMLElement {
  if (renamingBoardId !== state.boardId) {
    const btn = el('button', 'board-btn board-btn--compact', 'Rename');
    btn.type = 'button';
    btn.title = 'Rename this board';
    btn.addEventListener('click', () => {
      renamingBoardId = state.boardId;
      paintBoard();
      surface?.boardPane
        .querySelector<HTMLInputElement>('[data-focus-key="board-rename"]')
        ?.select();
    });
    return btn;
  }

  const form = el('form', 'board-header__rename');
  const input = el('input', 'board-header__rename-input');
  input.type = 'text';
  input.value = state.name || state.boardId;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Board name');
  input.dataset.focusKey = 'board-rename';
  form.appendChild(input);

  const save = el('button', 'board-btn board-btn--compact board-btn--primary', 'Save');
  save.type = 'submit';
  form.appendChild(save);
  const cancel = el('button', 'board-btn board-btn--compact', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    renamingBoardId = null;
    paintBoard();
  });
  form.appendChild(cancel);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    renamingBoardId = null;
    void commandRename(name);
  });
  return form;
}

function readConcurrencyInput(): number {
  const input = surface?.boardPane.querySelector<HTMLInputElement>('#ov2-concurrency-input');
  const n = Number(input?.value);
  if (!Number.isSafeInteger(n) || n < 1) return DEFAULT_BOARD_CONCURRENCY;
  return Math.min(64, n);
}

/**
 * The P3-G artifact. Loaded over GET, never from the fold, so a report cannot
 * leak back into scheduling if this view is later mistaken for a store.
 */
function showingReport(state: BoardState): boolean {
  return Boolean(selectedBoardId) && wantsReportScreen(state) && !reportDismissed.has(selectedBoardId!);
}

async function loadFinishReport(boardId: string): Promise<void> {
  if (finishReportLoads.has(boardId)) return;
  finishReportLoads.add(boardId);
  try {
    const { markdown } = await readBoardReport(boardId);
    finishReportByBoard.set(boardId, markdown);
    if (selectedBoardId === boardId) paintBoard();
  } catch {
    // 404 while the writer is still running; the next SSE tick retries.
  } finally {
    finishReportLoads.delete(boardId);
  }
}

function renderTimelineSection(): HTMLElement {
  const wrap = el('section', 'ov2-journal ob-sec');
  wrap.appendChild(el('h3', 'ov2-journal__title', 'Journal'));
  const body = el('div', 'ov2-journal__body');
  wrap.appendChild(body);
  wrap.dataset.role = 'journal';
  if (journalView?.boardId === selectedBoardId) {
    body.replaceChildren(renderTimeline(journalView.events, journalView.truncated));
  } else {
    body.textContent = 'Loading…';
  }
  return wrap;
}

async function loadTimeline(): Promise<void> {
  const boardId = selectedBoardId;
  if (!boardId) return;
  try {
    const { events, truncated } = await readJournal(boardId, { limit: TIMELINE_LIMIT });
    if (boardId !== selectedBoardId || !showTimeline) return;
    journalView = { boardId, events, truncated };
    const body = surface?.boardPane.querySelector<HTMLElement>('.ov2-journal__body');
    body?.replaceChildren(renderTimeline(events, truncated));
  } catch (err) {
    if (boardId !== selectedBoardId || !showTimeline) return;
    const body = surface?.boardPane.querySelector<HTMLElement>('.ov2-journal__body');
    body?.replaceChildren(
      el('p', 'ov2-notice ov2-notice--warn', err instanceof Error ? err.message : String(err)),
    );
  }
}

// ---------------------------------------------------------------------------
// Commands
//
// Each one POSTs and then does nothing. The board moves when the engine says it
// moved, over the stream — no optimistic update, and nothing here to undo when
// a command is refused.
// ---------------------------------------------------------------------------

async function run(what: string, command: () => Promise<void>): Promise<void> {
  try {
    await command();
    notice = null;
  } catch (err) {
    notice = { text: `${what} failed: ${err instanceof Error ? err.message : String(err)}`, tone: 'bad' };
    paintBoard();
  }
}

function commandStart(concurrency: number): Promise<void> {
  return run('Start', async () => {
    await client?.start(concurrency);
    void list?.refresh();
  });
}

function commandStop(): Promise<void> {
  return run('Stop', async () => {
    await client?.stop();
    void list?.refresh();
  });
}

function commandConcurrency(n: number): Promise<void> {
  return run('Concurrency', async () => {
    await client?.setConcurrency(n);
    void list?.refresh();
  });
}

function commandSetModel(providerId: string, id: string, reasoning: string): Promise<void> {
  return run('Model', async () => {
    await client?.setModel({
      providerId,
      id,
      ...(isBoardJournalReasoning(reasoning) ? { reasoning } : {}),
    });
  });
}

function commandRename(name: string): Promise<void> {
  return run('Rename', async () => {
    await client?.rename(name);
    void list?.refresh();
  });
}

/**
 * Give up on a task by hand — P9-H.
 *
 * The board does not grey the card out. It POSTs, the engine journals
 * `task.abandoned { reason: 'user' }`, and the card moves to Complete when the
 * fold says it did — the same path an automatic abandonment takes. That is the
 * difference between a manual override and a renderer-owned write, and it is why
 * anything depending on this task is stranded correctly rather than left in a
 * state only this window knows about.
 */
async function commandAbandonTask(taskId: string): Promise<void> {
  if (!client || pendingTasks.has(taskId)) return;
  pendingTasks.add(taskId);
  paintBoard();
  try {
    const abandoned = await client.abandonTask(taskId);
    notice = abandoned
      ? null
      : { text: `${taskId} has already finished.`, tone: 'warn' };
  } catch (err) {
    notice = {
      text: `Could not abandon ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      tone: 'bad',
    };
  } finally {
    pendingTasks.delete(taskId);
    paintBoard();
  }
}

async function commandStartTask(taskId: string): Promise<void> {
  if (!client || pendingTasks.has(taskId)) return;
  pendingTasks.add(taskId);
  paintBoard();
  try {
    const started = await client.startTask(taskId);
    notice = started
      ? null
      : {
          // The server decides, and it says no for reasons a view should not
          // guess at: the task is already running, its dependencies have not
          // merged, or its footprint overlaps something in flight.
          text: `${taskId} cannot start right now.`,
          tone: 'warn',
        };
  } catch (err) {
    notice = {
      text: `Could not start ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      tone: 'bad',
    };
  } finally {
    pendingTasks.delete(taskId);
    paintBoard();
  }
}

async function commandRerun(taskIds?: string[]): Promise<void> {
  if (!client || !selectedBoardId) return;
  return run('Rerun', async () => {
    const result = await client!.rerun(taskIds, readConcurrencyInput());
    if (!result.ok) {
      notice = { text: 'Nothing to rerun.', tone: 'warn' };
      return;
    }
    finishReportByBoard.delete(selectedBoardId!);
    reportDismissed.delete(selectedBoardId!);
    void list?.refresh();
  });
}
