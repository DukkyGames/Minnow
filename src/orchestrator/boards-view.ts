/**
 * P1-E — the Boards surface. Orchestrator V2's view.
 *
 * A **new surface**, not a retrofit of `orchestrate-board.ts`. V1's `BoardTask`
 * carries ~50 fields; V2's `TaskState` carries 17 and deliberately drops the
 * retry counters, `executionMode`, `handsOff`, `pendingAfk`, `autoRunning`,
 * `systemPaused` and `userStopped` that PRD §6 replaces with one enum and one
 * integer. Every V1 site reading a deleted field needs a decision rather than a
 * substitution, and V1's Orchestrate section is additionally wired to planner
 * chats, rails, onboarding and kickoff that V2 removes outright. So this is
 * built beside it and V1 is left alone until Phase 4 deletes it.
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
 * Merge and Final are still instant-pass (P3 owns a real merge queue). Live
 * agent output arrives as SSE `event: live` from P2-F; this view renders the
 * current tool name on the running task card.
 */

import '../styles/orchestrator-boards.css';

import type { BoardState } from '../../server/orchestrator/core/types';
import {
  createBoardClient,
  createBoardFromPlan,
  createBoardListClient,
  deleteBoard,
  PlanParseFailure,
  readAttemptTranscript,
  readJournal,
  type BoardClient,
  type BoardListClient,
  type BoardSummary,
} from './client';
import { populateMultiProviderModelSelect } from '../api/models';
import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';
import {
  renderBoardHeader,
  renderBoardSkeleton,
  renderEngineErrors,
  renderFinishReport,
  renderMergeQueue,
  renderTaskDetail,
  renderTaskList,
  renderTimeline,
  type TranscriptView,
} from './board-render';
import { withSessionToken } from '../api/session-token';
import {
  discoverOrchestratePlans,
  type DiscoverOrchestratePlansResult,
} from '../chat/orchestrate/list-plans';
import { button, el, empty, pill } from './dom';

/** UI copy for discoverOrchestratePlans error codes (kept here so V2 does not import V1 picker UI). */
const PLAN_LIST_HINTS: Record<string, string> = {
  server_off: 'Open or restart Minnow to list plans.',
  no_plans_dir: 'No documentation/plans folder in this workspace.',
};

/** Strip documentation/plans/ so the dropdown shows the basename, matching Orchestrate. */
function shortPlanLabel(fullPath: string): string {
  return fullPath.replace(/^documentation\/plans\//, '');
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
/** Manual starts awaiting their answer, so a button can say it is working. */
const pendingTasks = new Set<string>();
/** The last thing that went wrong, shown until the next successful command. */
let notice: { text: string; tone: 'warn' | 'bad' } | null = null;
/** The attempt transcript open in the detail panel — P9-D. */
let transcript: TranscriptView | null = null;
/** Board ids whose delete is awaiting a second click — P9-E. */
const confirmingDelete = new Set<string>();
/** The board id currently being renamed inline, if any — P9-E. */
let renamingBoardId: string | null = null;
/**
 * The model dropdown's options, fetched once — P9-C.
 *
 * The pane is rebuilt on every journal event, so the `<select>` is a new element
 * several times a minute on a live board. Re-running the provider round trip
 * each time would put a burst of HTTP against every enabled provider behind a
 * running run; the options do not change that fast. `null` means "not fetched
 * yet", and a failed fetch is retried on the next repaint rather than cached.
 */
let modelOptionsHtml: string | null = null;
/** In flight, so a burst of repaints asks once. */
let modelOptionsRequest: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export function isBoardsViewOpen(): boolean {
  return Boolean(document.getElementById(BOARDS_ROOT_ID));
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
  unsubscribeBoard?.();
  unsubscribeBoard = null;
  client?.close();
  client = null;
  unsubscribeList?.();
  unsubscribeList = null;
  list?.stop();
  list = null;

  document.getElementById(BOARDS_ROOT_ID)?.remove();
  const area = document.getElementById('chatArea');
  area?.classList.remove(CHAT_AREA_CLASS);
  document.getElementById('mainColumn')?.classList.remove(MAIN_COLUMN_CLASS);
  surface = null;
  selectedTaskId = null;
  pendingTasks.clear();
  confirmingDelete.clear();
  renamingBoardId = null;
  transcript = null;
  // Dropped with the surface: reopening Boards is the natural moment to notice
  // a provider that was enabled in the meantime.
  modelOptionsHtml = null;
  modelOptionsRequest = null;
  notice = null;
  syncRailButton();
}

export async function closeBoardsView(): Promise<void> {
  const { notifyCodeStageViewChanged } = await import('../ui/main-column-overlay');
  teardownBoardsView();
  notifyCodeStageViewChanged();
}

function syncRailButton(): void {
  const btn = document.getElementById('btnOrchestratorBoards');
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
  transcript = null;
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
      onClick: () => openCreateForm(),
    }),
  );
  pane.appendChild(head);

  const boards = list?.getBoards() ?? [];
  if (boards.length === 0) {
    pane.appendChild(empty('No boards yet. Create one from a plan file.'));
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
  const item = el('li', 'ov2__board-item ob-row');
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
  // rather than ask an abstract question.
  const confirming = confirmingDelete.has(board.boardId);
  const remove = el(
    'button',
    `ov2__board-delete${confirming ? ' is-confirming' : ''}`,
    confirming ? 'Delete the journal too?' : 'Delete',
  );
  remove.type = 'button';
  remove.dataset.focusKey = `delete:${board.boardId}`;
  remove.title = confirming
    ? `Deleting ${board.boardId} removes its journal — the only record of what the run did.`
    : `Delete ${board.boardId}`;
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

function openCreateForm(): void {
  if (!surface) return;
  void mountCreateForm(surface.boardPane, {
    onCreated: (boardId) => {
      void list?.refresh();
      selectBoard(boardId);
    },
    onCancel: () => paintBoard(),
  });
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
    pane.replaceChildren(renderNoSelection());
    return;
  }

  const state = client?.getState() ?? null;
  if (!state) {
    // A skeleton in the board's own shape, not the word "Loading" — P9-I.
    pane.replaceChildren(renderBoardSkeleton());
    return;
  }

  const connected = client?.isConnected() ?? false;
  const scrollTop = pane.scrollTop;
  const focused = captureFocus();
  pane.replaceChildren();
  pane.appendChild(renderBoardHeader(state, connected));
  pane.appendChild(renderControls(state));
  const errors = renderEngineErrors(client?.getEngineErrors());
  if (errors) pane.appendChild(errors);
  if (notice) {
    const line = el('p', `ov2-notice ov2-notice--${notice.tone}`, notice.text);
    line.setAttribute('role', 'status');
    pane.appendChild(line);
  }

  const actions = {
    startTask: (taskId: string) => void commandStartTask(taskId),
    abandonTask: (taskId: string) => void commandAbandonTask(taskId),
    select: (taskId: string | null) => {
      selectedTaskId = taskId;
      transcript = null;
      paintBoard();
    },
    openTranscript: (attemptId: string) => void toggleTranscript(attemptId),
  };
  const options = {
    selectedTaskId,
    pendingTaskIds: pendingTasks,
    liveHeadlines: client?.getLiveHeadlines(),
    engineErrors: client?.getEngineErrors(),
    transcript,
  };

  pane.appendChild(renderTaskList(state, actions, options));

  const selected = selectedTaskId ? state.tasks.get(selectedTaskId) : undefined;
  if (selected) pane.appendChild(renderTaskDetail(state, selected, actions, options));

  const report = renderFinishReport(state);
  if (report) pane.appendChild(report);

  pane.appendChild(renderMergeQueue(state));
  pane.appendChild(renderTimelineSection());
  // Repainting from scratch is what keeps the view a pure function of the
  // state; restoring the scroll offset and the focus is what stops that being
  // felt as a keyboard user losing their place every five seconds.
  pane.scrollTop = scrollTop;
  restoreFocus(focused);
}

/** The pane with no board selected — P9-I. */
function renderNoSelection(): HTMLElement {
  const wrap = el('div', 'ov2-blank ob-pane--ask');
  wrap.appendChild(el('p', 'ov2-blank__title', 'No board open.'));
  wrap.appendChild(
    el(
      'p',
      'ov2-blank__body',
      'Pick one from the rail, or create a board from a plan under documentation/plans/. ' +
        'A board is a snapshot of the plan it was made from, and its journal is kept forever.',
    ),
  );
  wrap.appendChild(
    button({
      label: 'New board',
      variant: 'primary',
      onClick: () => openCreateForm(),
    }),
  );
  return wrap;
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
    paintBoard();
    return;
  }
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

function renderControls(state: BoardState): HTMLElement {
  const bar = el('div', 'ov2-controls');

  const concurrency = el('input', 'ov2-controls__number');
  concurrency.type = 'number';
  concurrency.min = '1';
  concurrency.max = '64';
  concurrency.value = String(state.concurrency);
  concurrency.setAttribute('aria-label', 'Concurrency');

  const running = state.status === 'running';
  bar.appendChild(
    button({
      label: running ? 'Restart at N' : 'Start',
      title: 'Start the reconcile loop at this concurrency',
      variant: 'primary',
      disabled: state.finished,
      onClick: () => void commandStart(Number(concurrency.value)),
    }),
  );
  bar.appendChild(
    button({
      label: 'Stop',
      title: 'Stop the loop and everything it is running',
      variant: 'danger',
      disabled: !running,
      onClick: () => void commandStop(),
    }),
  );

  const stepper = el('div', 'ov2-controls__stepper');
  stepper.appendChild(el('span', 'ov2-controls__label', 'Concurrency'));
  stepper.appendChild(concurrency);
  stepper.appendChild(
    button({
      label: 'Apply',
      title: 'Lowering this stops nothing already in flight — it stops new work being picked up',
      disabled: !running,
      onClick: () => void commandConcurrency(Number(concurrency.value)),
    }),
  );
  bar.appendChild(stepper);

  bar.appendChild(renderModelChip(state));
  bar.appendChild(renderRenameControl(state));

  if (!running && !state.finished) {
    // PRD §6: Manual = Stopped, with the user starting individual tasks by hand.
    bar.appendChild(
      el('span', 'ov2-controls__mode', 'Stopped — start individual tasks by hand below.'),
    );
  }
  return bar;
}

/**
 * The board's model binding — P9-C.
 *
 * V2 resolved a model from Settings → Autopilot or the active chat's menubar
 * binding, both invisible from here and neither addressable per board. That is
 * what made P9-A's failure mode unfixable in place: the board said "no model
 * bound for this attempt" and the control that would fix it was three screens
 * away. The `board.model.set` command puts it on the journal, where the effector
 * reads it first and replay reproduces which model an attempt actually ran on.
 */
function renderModelChip(state: BoardState): HTMLElement {
  const wrap = el('div', 'ov2-controls__model');
  wrap.appendChild(el('span', 'ov2-controls__label', 'Model'));

  const select = el('select', 'ov2-controls__select');
  select.setAttribute('aria-label', 'Model for this board');
  select.dataset.focusKey = 'board-model';
  select.addEventListener('change', () => {
    const decoded = decodeModelSelectKey(select.value);
    if (!decoded) return;
    void commandSetModel(decoded.providerId, decoded.modelId, reasoning.value);
  });
  wrap.appendChild(select);

  const bound = state.model;
  const selected = bound ? encodeModelSelectKey(bound.providerId, bound.id) : '';
  if (modelOptionsHtml !== null) {
    select.innerHTML = modelOptionsHtml;
    select.value = [...select.options].some((o) => o.value === selected) ? selected : '';
  } else {
    // Fetched after mount, once: the provider round trip must not hold up a
    // repaint, and this pane repaints on every journal event.
    select.innerHTML = '<option value="">Loading models…</option>';
    modelOptionsRequest ??= populateMultiProviderModelSelect(select, {
      includeEmptyOption: true,
      emptyLabel: '(Settings → Autopilot)',
      ...(bound ? { selectedProviderId: bound.providerId, selectedModelId: bound.id } : {}),
    })
      .then(() => {
        modelOptionsHtml = select.innerHTML;
      })
      .catch(() => {
        // Not cached, so the next repaint tries again.
        select.innerHTML = '<option value="">Cannot reach providers</option>';
      })
      .finally(() => {
        modelOptionsRequest = null;
      });
  }

  // Reasoning is the other half of a binding: a thinking model bound with
  // thinking off is a different model in every way that matters.
  const reasoning = el('select', 'ov2-controls__select ov2-controls__select--narrow');
  reasoning.setAttribute('aria-label', 'Reasoning for this board');
  reasoning.dataset.focusKey = 'board-reasoning';
  for (const [value, label] of [
    ['', 'Reasoning: default'],
    ['on', 'Reasoning: on'],
    ['off', 'Reasoning: off'],
  ] as const) {
    const option = el('option');
    option.value = value;
    option.textContent = label;
    reasoning.appendChild(option);
  }
  reasoning.value = state.model?.reasoning ?? '';
  reasoning.addEventListener('change', () => {
    // Reasoning rides on the same journaled binding, so it needs a model to
    // ride on. Saying so beats silently doing nothing.
    if (!state.model) {
      notice = { text: 'Pick a model for this board first.', tone: 'warn' };
      paintBoard();
      return;
    }
    void commandSetModel(state.model.providerId, state.model.id, reasoning.value);
  });
  wrap.appendChild(reasoning);

  if (!bound) {
    wrap.appendChild(
      el('span', 'ov2-controls__hint', 'Unbound — attempts use the Autopilot planner model.'),
    );
  }
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
    return button({
      label: 'Rename',
      title: 'Rename this board',
      variant: 'ghost',
      onClick: () => {
        renamingBoardId = state.boardId;
        paintBoard();
        surface?.boardPane
          .querySelector<HTMLInputElement>('[data-focus-key="board-rename"]')
          ?.select();
      },
    });
  }

  const form = el('form', 'ov2-controls__rename');
  const input = el('input', 'ov2-controls__input');
  input.type = 'text';
  input.value = state.name || state.boardId;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Board name');
  input.dataset.focusKey = 'board-rename';
  form.appendChild(input);

  const save = el('button', 'ov2-btn ov2-btn--primary', 'Save');
  save.type = 'submit';
  form.appendChild(save);
  form.appendChild(
    button({
      label: 'Cancel',
      variant: 'ghost',
      onClick: () => {
        renamingBoardId = null;
        paintBoard();
      },
    }),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    renamingBoardId = null;
    void commandRename(name);
  });
  return form;
}

function renderTimelineSection(): HTMLElement {
  const wrap = el('section', 'ov2-journal');
  const head = el('div', 'ov2-journal__head');
  head.appendChild(el('h3', 'ov2-journal__title', 'Journal'));
  head.appendChild(
    button({
      label: showTimeline ? 'Hide' : 'Show',
      variant: 'ghost',
      onClick: () => {
        showTimeline = !showTimeline;
        paintBoard();
        if (showTimeline) void loadTimeline();
      },
    }),
  );
  wrap.appendChild(head);
  if (showTimeline) {
    wrap.appendChild(el('div', 'ov2-journal__body', 'Loading…'));
    wrap.dataset.role = 'journal';
  }
  return wrap;
}

async function loadTimeline(): Promise<void> {
  const boardId = selectedBoardId;
  if (!boardId) return;
  try {
    const { events, truncated } = await readJournal(boardId, { limit: TIMELINE_LIMIT });
    if (boardId !== selectedBoardId || !showTimeline) return;
    const body = surface?.boardPane.querySelector<HTMLElement>('.ov2-journal__body');
    body?.replaceChildren(renderTimeline(events, truncated));
  } catch (err) {
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
      ...(reasoning === 'on' || reasoning === 'off' ? { reasoning } : {}),
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
