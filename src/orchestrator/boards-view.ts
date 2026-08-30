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
 * ## What it cannot do yet
 *
 * Merge is the serialized rebase-then-merge queue (P3-C). Final is the static
 * ladder (P3-F); the browser step waits for Phase 5. The end-of-run report is
 * the persisted `report.md` artifact (P3-G), not a planner chat. Live agent
 * output arrives as SSE `event: live` from P2-F; this view renders the
 * current tool name on the running task row.
 */

import '../styles/orchestrator-boards.css';

import type { BoardState } from '../../server/orchestrator/core/types';
import { DEFAULT_BOARD_CONCURRENCY } from '../../server/orchestrator/core/derive.js';
import {
  createBoardClient,
  createBoardFromPlan,
  createBoardListClient,
  PlanParseFailure,
  readJournal,
  readBoardReport,
  type BoardClient,
  type BoardListClient,
  type BoardSummary,
} from './client';
import {
  renderBoardHeader,
  renderMergeQueue,
  renderTaskList,
  renderTimeline,
  renderFinishReport,
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
/** Persisted P3-G report, keyed by board. Presentation only — never folded. */
const finishReportByBoard = new Map<string, string>();
/** In-flight GET so a paint loop does not stampede the endpoint. */
const finishReportLoads = new Set<string>();

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

  const root = el('div', 'ov2');
  root.id = BOARDS_ROOT_ID;
  const listPane = el('aside', 'ov2__list');
  const boardPane = el('section', 'ov2__board');
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
  pendingTasks.clear();
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
  const item = el('li', 'ov2__board-item');
  const btn = el('button', 'ov2__board-btn');
  btn.type = 'button';
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
  return item;
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

function paintBoard(): void {
  if (!surface) return;
  const pane = surface.boardPane;

  if (!selectedBoardId) {
    pane.replaceChildren(empty('Pick a board, or create one from a plan.'));
    return;
  }

  const state = client?.getState() ?? null;
  if (!state) {
    pane.replaceChildren(empty('Loading the board…'));
    return;
  }

  const connected = client?.isConnected() ?? false;
  const scrollTop = pane.scrollTop;
  pane.replaceChildren();
  pane.appendChild(renderBoardHeader(state, connected));
  pane.appendChild(renderControls(state));
  if (notice) {
    pane.appendChild(el('p', `ov2-notice ov2-notice--${notice.tone}`, notice.text));
  }
  pane.appendChild(
    renderTaskList(
      state,
      {
        startTask: (taskId) => void commandStartTask(taskId),
        select: (taskId) => {
          selectedTaskId = taskId;
          paintBoard();
        },
      },
      { selectedTaskId, pendingTaskIds: pendingTasks, liveHeadlines: client?.getLiveHeadlines() },
    ),
  );
  pane.appendChild(renderMergeQueue(state));
  pane.appendChild(renderFinishSection(state));
  pane.appendChild(renderTimelineSection());
  // Repainting from scratch is what keeps the view a pure function of the
  // state; restoring the scroll offset is what stops that being felt.
  pane.scrollTop = scrollTop;
}

function renderControls(state: BoardState): HTMLElement {
  const bar = el('div', 'ov2-controls');
  const finished = state.finished;
  const running = state.status === 'running';
  // Created boards are not ticking — that is Stopped in PRD §6's pair, even
  // though the fold still says `created` until the first start.
  const loopOn = running;

  const status = el('div', 'ov2-controls__status');
  status.setAttribute('role', 'group');
  status.setAttribute('aria-label', 'Board loop');
  status.appendChild(
    button({
      label: 'Running',
      title: 'Start or keep the reconcile loop. Sequential is this at N=1; AFK is this with no interactive gates.',
      variant: loopOn ? 'primary' : 'ghost',
      disabled: finished || loopOn,
      onClick: () => void commandStart(readConcurrencyInput()),
    }),
  );
  status.appendChild(
    button({
      label: 'Stopped',
      title: 'Stop the loop. Manual mode is this plus per-task Start on a card.',
      variant: !loopOn ? 'primary' : 'ghost',
      disabled: finished || !loopOn,
      onClick: () => void commandStop(),
    }),
  );
  bar.appendChild(status);

  const concurrency = el('input', 'ov2-controls__number');
  concurrency.type = 'number';
  concurrency.min = '1';
  concurrency.max = '64';
  // Pre-start fold is 1; the stepper shows the product default so the first
  // start journals 2 unless the user changed it.
  const shownN =
    state.status === 'created' ? DEFAULT_BOARD_CONCURRENCY : state.concurrency;
  concurrency.value = String(shownN);
  concurrency.setAttribute('aria-label', 'Concurrency');
  concurrency.id = 'ov2-concurrency-input';
  concurrency.addEventListener('input', () => {
    const n = Number(concurrency.value);
    paintResourceHint(bar, Number.isSafeInteger(n) && n >= 1 ? Math.min(64, n) : DEFAULT_BOARD_CONCURRENCY);
  });

  const stepper = el('div', 'ov2-controls__stepper');
  stepper.appendChild(el('span', 'ov2-controls__label', 'Concurrency'));
  stepper.appendChild(
    button({
      label: '−',
      title: 'Lower N. In-flight attempts keep running; only new starts wait.',
      disabled: finished,
      onClick: () => {
        concurrency.value = String(Math.max(1, readConcurrencyInput() - 1));
        paintResourceHint(bar, readConcurrencyInput());
      },
    }),
  );
  stepper.appendChild(concurrency);
  stepper.appendChild(
    button({
      label: '+',
      title: 'Raise N. The next tick may start more work; nothing already running is restarted.',
      disabled: finished,
      onClick: () => {
        concurrency.value = String(Math.min(64, readConcurrencyInput() + 1));
        paintResourceHint(bar, readConcurrencyInput());
      },
    }),
  );
  if (running) {
    stepper.appendChild(
      button({
        label: 'Apply',
        title: 'Takes effect on the next tick. Lowering stops nothing already in flight.',
        onClick: () => void commandConcurrency(readConcurrencyInput()),
      }),
    );
  }
  bar.appendChild(stepper);

  const hint = el('p', 'ov2-controls__hint');
  hint.dataset.role = 'resource-hint';
  bar.appendChild(hint);
  // The input is not in the pane yet; use the value we just put on it.
  paintResourceHint(bar, shownN);

  if (!loopOn && !finished) {
    bar.appendChild(
      el(
        'span',
        'ov2-controls__mode',
        'Stopped — start individual tasks by hand below, or switch to Running.',
      ),
    );
  } else if (loopOn && shownN === 1) {
    bar.appendChild(el('span', 'ov2-controls__mode', 'Sequential: Running at N=1.'));
  } else if (loopOn) {
    bar.appendChild(
      el('span', 'ov2-controls__mode', 'AFK: Running with no interactive gates.'),
    );
  }
  return bar;
}

function readConcurrencyInput(): number {
  const input = surface?.boardPane.querySelector<HTMLInputElement>('#ov2-concurrency-input');
  const n = Number(input?.value);
  if (!Number.isSafeInteger(n) || n < 1) return DEFAULT_BOARD_CONCURRENCY;
  return Math.min(64, n);
}

function paintResourceHint(bar: HTMLElement, n: number): void {
  const hint = bar.querySelector<HTMLElement>('[data-role="resource-hint"]');
  if (!hint) return;
  // Surface the cost; do not enforce a host cap. Concurrent agents are
  // concurrent model calls and concurrent worktrees — the user picks N.
  hint.textContent =
    `N=${n} means up to ${n} concurrent agents: ${n} model calls and ${n} worktrees. ` +
    'There is no hard cap; pick what this machine can hold.';
}

/**
 * The P3-G artifact. Loaded over GET, never from the fold, so a report cannot
 * leak back into scheduling if this view is later mistaken for a store.
 */
function renderFinishSection(state: BoardState): HTMLElement {
  const wantsReport = state.finished || (state.status === 'stopped' && state.stopReason === 'user');
  if (!wantsReport || !selectedBoardId) {
    return el('div', 'ov2-finish ov2-finish--idle');
  }
  const cached = finishReportByBoard.get(selectedBoardId) ?? null;
  if (!cached) void loadFinishReport(selectedBoardId);
  return renderFinishReport(cached, !cached);
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
