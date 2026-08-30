/**
 * P1-E — the renderer's view of a board.
 *
 * Locked decision 2: **the renderer is a view.** It subscribes, derives, and
 * POSTs commands. It never mutates board state, and there is no code path here
 * that could — the only writes available are the commands the engine chose to
 * expose.
 *
 * That is not a style preference. The renderer *being* the engine is the entire
 * reason `board-display-wake.ts`, `board-boot-resume.ts`, and `oom-recovery.ts`
 * exist in V1: a sleeping display was a correctness problem. Here a sleeping
 * display is a stale view, and the fix is a reconnect.
 *
 * ## Deriving, not receiving
 *
 * The client folds the event stream with the *same* `derive()` the server uses —
 * imported straight from `server/orchestrator/core/derive.js`, the pattern
 * `src/ui/terminal-panel.ts` already uses for `server/tools/output-cap.js`. One
 * implementation of board state, shared by both sides, so the view cannot
 * disagree with the engine about what the journal means.
 *
 * ## What a consumer gets, and why it is a copy
 *
 * `foldInto` mutates in place. That is right for the engine, which holds one
 * state and advances it, and wrong at a UI boundary: handing every listener the
 * same object reference every time means anything deciding whether to re-render
 * by reference equality sees nothing change, ever. So the folded state is
 * private, and `getState()` returns a **frozen structural copy** rebuilt only
 * when the state actually moved. Reference equality therefore means exactly
 * what a view expects it to mean, and a view that tries to write to what it was
 * given throws instead of silently corrupting itself.
 */

import { foldInto } from '../../server/orchestrator/core/derive.js';
import { stateFromJSON } from '../../server/orchestrator/core/snapshot.js';
import type {
  Attempt,
  BoardState,
  ParseError,
  TaskState,
} from '../../server/orchestrator/core/types';

/** A board as it appears in the list. */
export interface BoardSummary {
  boardId: string;
  name: string;
  planPath: string;
  status: BoardState['status'];
  concurrency: number;
  taskCount: number;
  finished: boolean;
}

/**
 * The bit of `EventSource` this client uses.
 *
 * Narrowed to an interface so tests can drive the stream without one: Node has
 * `EventSource` only behind a flag and happy-dom has none at all, and a client
 * that can only be tested in a browser is a client that does not get tested.
 */
export interface EventStream {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface BoardClientOptions {
  /** Defaults to the platform `EventSource`. */
  openStream?: (url: string) => EventStream;
}

/** Latest live attempt activity for one task, from SSE `event: live`. Never journaled. */
export interface LiveHeadline {
  attemptId: string;
  role: string;
  /** Tool name, or a short token preview. */
  text: string;
}

export interface BoardClient {
  readonly boardId: string;
  /**
   * The current derived state, or null before the first frame arrives.
   *
   * A frozen copy, and a **new object identity on every change** — so
   * `previous !== current` is a correct "did anything move" test.
   */
  getState(): BoardState | null;
  /** True while the SSE stream is open. */
  isConnected(): boolean;
  /** The `seq` the state is folded through. 0 before the first frame. */
  getSeq(): number;
  /**
   * Live agent output keyed by task id.
   *
   * Parallel to the journal fold: tokens and tool names ride `event: live`
   * (no `seq`) so a reconnect cannot treat a token as a journal id. The
   * map is presentation-only and is never written back to the server.
   */
  getLiveHeadlines(): ReadonlyMap<string, LiveHeadline>;
  /** Notified on every state change, including connection changes and live tools. */
  subscribe(listener: (state: BoardState | null) => void): () => void;
  connect(): void;
  close(): void;

  // Commands. Each is a POST; none of them touches local state directly.
  start(concurrency?: number): Promise<void>;
  stop(): Promise<void>;
  setConcurrency(n: number): Promise<void>;
  startTask(taskId: string): Promise<boolean>;
}

/** Thrown by `createBoardFromPlan` when the plan does not parse. */
export class PlanParseFailure extends Error {
  readonly errors: ParseError[];

  constructor(message: string, errors: ParseError[]) {
    super(message);
    this.name = 'PlanParseFailure';
    this.errors = errors;
  }
}

/**
 * @param path relative to `/api/boards`
 */
async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`/api/boards${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    if (Array.isArray(body?.errors)) {
      throw new PlanParseFailure(body.detail ?? body.error ?? 'the plan does not parse', body.errors);
    }
    throw new Error(body?.error ?? `${response.status} from /api/boards${path}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Read-only board state
// ---------------------------------------------------------------------------

/**
 * A frozen structural copy of a board state.
 *
 * Deep, because a shallow copy would leave every `TaskState` shared with the
 * private state the next fold mutates — which is the same bug in a smaller box.
 *
 * The `tasks` Map is frozen *and* has its mutators replaced: `Object.freeze` on
 * a `Map` blocks adding properties but does nothing about `set`, which is
 * exactly the write a view would reach for.
 */
function readOnlyState(state: BoardState): BoardState {
  const tasks = new Map<string, TaskState>();
  for (const [id, task] of state.tasks) tasks.set(id, freezeTask(task));

  const copy: BoardState = {
    boardId: state.boardId,
    name: state.name,
    planPath: state.planPath,
    waves: Object.freeze(state.waves.map((w) => Object.freeze({ ...w }))) as BoardState['waves'],
    status: state.status,
    concurrency: state.concurrency,
    tasks: sealMap(tasks),
    taskOrder: Object.freeze([...state.taskOrder]) as string[],
    mergeQueue: Object.freeze([...state.mergeQueue]) as string[],
    integrationSha: state.integrationSha,
    finalTest: state.finalTest === null ? null : Object.freeze({ ...state.finalTest }),
    finished: state.finished,
    stopReason: state.stopReason,
    runSummary: state.runSummary,
  };
  return Object.freeze(copy);
}

function freezeTask(task: TaskState): TaskState {
  return Object.freeze({
    ...task,
    dependsOn: Object.freeze([...task.dependsOn]) as string[],
    touches: Object.freeze([...task.touches]) as string[],
    touchesExpanded:
      task.touchesExpanded === null || task.touchesExpanded === undefined
        ? null
        : (Object.freeze([...task.touchesExpanded]) as string[]),
    emptyTouchesGlobs: Object.freeze([...(task.emptyTouchesGlobs ?? [])]) as string[],
    attempts: Object.freeze(
      task.attempts.map((a) => Object.freeze({ ...a }) as Attempt),
    ) as Attempt[],
    touchesOverflow: Object.freeze(
      task.touchesOverflow.map((o) =>
        Object.freeze({
          ...o,
          declared: Object.freeze([...o.declared]),
          actual: Object.freeze([...o.actual]),
        }),
      ),
    ) as TaskState['touchesOverflow'],
  });
}

/** Make a Map read-only for real, not just non-extensible. */
function sealMap<K, V>(map: Map<K, V>): Map<K, V> {
  const refuse = () => {
    throw new TypeError('the board state is a view and cannot be written to');
  };
  Object.defineProperties(map, {
    set: { value: refuse },
    delete: { value: refuse },
    clear: { value: refuse },
  });
  return Object.freeze(map);
}

// ---------------------------------------------------------------------------
// One-shot reads
// ---------------------------------------------------------------------------

/** Every board the server knows about. */
export async function listBoards(): Promise<BoardSummary[]> {
  const body = await request('');
  return body.boards ?? [];
}

/**
 * Create a board from a plan file.
 *
 * Throws {@link PlanParseFailure} with line-numbered errors when the plan does
 * not parse, so the caller can show the author exactly what to fix rather than
 * "board creation failed".
 */
export async function createBoardFromPlan(
  planPath: string,
  options: { boardId?: string; markdown?: string } = {},
): Promise<{ boardId: string; state: BoardState }> {
  const body = await request('', {
    method: 'POST',
    body: JSON.stringify({ planPath, ...options }),
  });
  return { boardId: body.boardId, state: stateFromJSON(body.state) };
}

/**
 * A window on the raw journal, for the timeline drawer and for debugging.
 *
 * Journals are kept forever by design (PRD §11 needs the history), so this asks
 * for a window rather than the lot. `since` is a `seq` — the same number the SSE
 * frames carry — so a caller already holding events knows what to ask for, and
 * `limit` takes the most recent N. `truncated` says whether anything older was
 * left behind.
 */
export async function readJournal(
  boardId: string,
  options: { since?: number; limit?: number } = {},
): Promise<{ events: Record<string, unknown>[]; truncated: boolean }> {
  const query = new URLSearchParams();
  if (options.since !== undefined && options.since > 0) query.set('since', String(options.since));
  if (options.limit !== undefined && options.limit > 0) query.set('limit', String(options.limit));
  const suffix = query.toString() ? `?${query}` : '';
  const body = await request(`/${encodeURIComponent(boardId)}/journal${suffix}`);
  return { events: body.events ?? [], truncated: Boolean(body.truncated) };
}

/**
 * The persisted end-of-run report (P3-G). Separate from the fold so the
 * markdown cannot become input to plan() / derive().
 */
export async function readBoardReport(
  boardId: string,
): Promise<{ markdown: string; path: string }> {
  const body = await request(`/${encodeURIComponent(boardId)}/report`);
  return { markdown: String(body.markdown ?? ''), path: String(body.path ?? 'report.md') };
}

// ---------------------------------------------------------------------------
// The board list, kept fresh
// ---------------------------------------------------------------------------

export interface BoardListClient {
  getBoards(): BoardSummary[];
  /** The last error from a refresh, or null. A stale list is not a crash. */
  getError(): Error | null;
  subscribe(listener: (boards: BoardSummary[]) => void): () => void;
  /** Fetch now, outside the poll — after creating or commanding a board. */
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * The board list, kept fresh by polling.
 *
 * **Polling, and said out loud rather than hidden**, because the server has no
 * list-level stream: `GET /api/boards/events` does not exist, and a board's own
 * stream cannot report a board that was created in another window. Listeners
 * fire only when the list actually differs, so an idle list is silent.
 *
 * The right long-term answer is a list stream on the server; until then this is
 * the honest shape, and it is why `refresh()` exists — a command issued here
 * updates the list immediately instead of waiting out the interval.
 */
export function createBoardListClient(
  options: { intervalMs?: number; fetchBoards?: () => Promise<BoardSummary[]> } = {},
): BoardListClient {
  const intervalMs = options.intervalMs ?? 5_000;
  const fetchBoards = options.fetchBoards ?? listBoards;
  const listeners = new Set<(boards: BoardSummary[]) => void>();

  let boards: BoardSummary[] = [];
  let error: Error | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let signature = '';

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(boards);
      } catch (err) {
        console.error('[orchestrator] board-list subscriber threw', err);
      }
    }
  };

  const refresh = async () => {
    try {
      const next = await fetchBoards();
      error = null;
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      boards = Object.freeze(next.map((b) => Object.freeze({ ...b }))) as BoardSummary[];
      emit();
    } catch (err) {
      // A failed poll leaves the last good list in place. Losing the network for
      // one interval should not empty the screen.
      error = err instanceof Error ? err : new Error(String(err));
    }
  };

  return {
    getBoards: () => boards,
    getError: () => error,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    start() {
      if (timer !== null) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

// ---------------------------------------------------------------------------
// One board, live
// ---------------------------------------------------------------------------

/**
 * Open a live view of one board.
 *
 * Reconnection is the browser's: `EventSource` retries on its own and replays
 * `Last-Event-ID`, which the server answers with exactly the missed tail. So a
 * dropped connection costs the tail, not a re-fold from event zero — and a
 * laptop lid closed for an hour catches up in one round trip.
 */
export function createBoardClient(
  boardId: string,
  options: BoardClientOptions = {},
): BoardClient {
  const openStream = options.openStream ?? ((url: string) => new EventSource(url) as EventStream);

  /** The folded state. Private, because `foldInto` mutates it. */
  let internal: BoardState | null = null;
  /** What consumers see: a frozen copy, replaced whenever `internal` moves. */
  let view: BoardState | null = null;
  /** The seq `internal` is folded through. */
  let seq = 0;
  /**
   * Live tool/token headlines. Not folded: the journal must stay bounded by
   * outcomes (P2-F). Keyed by task id so a row can show what the agent is doing.
   */
  const liveHeadlines = new Map<string, LiveHeadline>();

  let source: EventStream | null = null;
  let connected = false;

  /**
   * Events that arrived before the baseline they belong after.
   *
   * On a **resume** the server sends the missed tail and no snapshot at all, so
   * "the snapshot will contain this" is false and dropping them loses the
   * catch-up entirely. They are held until there is something to fold them into.
   */
  let pending: Record<string, unknown>[] = [];

  const listeners = new Set<(state: BoardState | null) => void>();

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(view);
      } catch (err) {
        console.error('[orchestrator] board subscriber threw', err);
      }
    }
  };

  /** Rebuild the public copy and tell everyone. */
  const publish = () => {
    view = internal === null ? null : readOnlyState(internal);
    emit();
  };

  /** Fold one event, ignoring anything the state already contains. */
  const applyEvent = (event: Record<string, unknown>): boolean => {
    if (!internal) return false;
    const eventSeq = Number(event.seq);
    if (Number.isSafeInteger(eventSeq) && eventSeq <= seq) return false;
    // The same fold the server runs. There is no second interpretation of an
    // event anywhere in the system.
    foldInto(internal, [event]);
    if (Number.isSafeInteger(eventSeq)) seq = eventSeq;
    return true;
  };

  const drainPending = (): boolean => {
    if (pending.length === 0) return false;
    const queued = pending;
    pending = [];
    let changed = false;
    for (const event of queued) changed = applyEvent(event) || changed;
    return changed;
  };

  /** Take a baseline, dropping one that is older than what we already have. */
  const adopt = (state: BoardState, at: number) => {
    if (internal !== null && at < seq) return false;
    internal = state;
    seq = at;
    drainPending();
    return true;
  };

  const onSnapshot = (event: { data: string }) => {
    try {
      const payload = JSON.parse(event.data);
      // `>= seq` rather than unconditional: the baseline fetch below can land
      // after a snapshot frame taken earlier, and taking the older of the two
      // would walk the view backwards.
      if (adopt(stateFromJSON(payload.state), Number(payload.seq) || 0)) publish();
    } catch (err) {
      console.error('[orchestrator] could not read the board snapshot', err);
    }
  };

  const onLive = (event: { data: string }) => {
    try {
      const payload = JSON.parse(event.data) as {
        attemptId?: string;
        taskId?: string | null;
        role?: string;
        event?: { type?: string; name?: string; text?: string };
      };
      const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
      if (!taskId) return;
      const inner = payload.event;
      // Tool calls are the useful "what is it doing" signal. Token deltas would
      // repaint the board on every chunk — skip them here; the running pill
      // already says the attempt is live.
      if (inner?.type !== 'tool_call' && inner?.type !== 'tool_result') return;
      const name = typeof inner.name === 'string' && inner.name ? inner.name : inner.type;
      liveHeadlines.set(taskId, {
        attemptId: String(payload.attemptId ?? ''),
        role: String(payload.role ?? ''),
        text: inner.type === 'tool_result' ? `${name} done` : name,
      });
      emit();
    } catch (err) {
      console.error('[orchestrator] could not read a live attempt event', err);
    }
  };

  const onEvent = (event: { data: string }) => {
    try {
      const journalEvent = JSON.parse(event.data);
      if (!internal) {
        // No baseline yet. On a fresh connect a snapshot is on its way; on a
        // **resume** the server sends the tail and no snapshot at all, so these
        // events *are* the catch-up. Hold them either way — dropping them, on
        // the assumption a snapshot will contain them, silently loses a resume.
        pending.push(journalEvent);
        void ensureBaseline();
        return;
      }
      if (applyEvent(journalEvent)) publish();
    } catch (err) {
      console.error('[orchestrator] could not fold a board event', err);
    }
  };

  /** In flight, so a burst of resumed events asks for one baseline, not twenty. */
  let baselineRequest: Promise<void> | null = null;

  /**
   * Fetch the current state, for when the stream will not supply one.
   *
   * Issued alongside `connect()` rather than only on demand: it is one cheap
   * read against an engine that is already loaded, it paints the board before
   * the stream has finished opening, and it is the only thing that establishes
   * a baseline when a stream resumes — a resume carries the missed tail and no
   * snapshot, and an empty tail carries nothing at all.
   */
  const ensureBaseline = () => {
    if (internal || baselineRequest) return baselineRequest ?? Promise.resolve();
    baselineRequest = (async () => {
      try {
        const body = await request(`/${encodeURIComponent(boardId)}`);
        // `seq` is not on this response; the events held in `pending` carry
        // their own, and anything the fetched state already contains is skipped
        // by `applyEvent` on the way in.
        if (adopt(stateFromJSON(body.state), 0)) publish();
      } catch (err) {
        console.error('[orchestrator] could not establish a baseline for the board', err);
      } finally {
        baselineRequest = null;
      }
    })();
    return baselineRequest;
  };

  return {
    boardId,

    getState: () => view,
    isConnected: () => connected,
    getSeq: () => seq,
    getLiveHeadlines: () => liveHeadlines,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    connect() {
      if (source) return;
      // In parallel with the stream, not after it: see `ensureBaseline`.
      void ensureBaseline();
      source = openStream(`/api/boards/${encodeURIComponent(boardId)}/events`);
      source.addEventListener('snapshot', onSnapshot);
      source.addEventListener('event', onEvent);
      source.addEventListener('live', onLive);
      source.addEventListener('open', () => {
        connected = true;
        emit();
      });
      source.addEventListener('error', () => {
        // EventSource reconnects by itself, carrying Last-Event-ID. Nothing to
        // repair here, which is the point.
        connected = false;
        emit();
      });
    },

    close() {
      source?.close();
      source = null;
      if (!connected) return;
      connected = false;
      // Announced, not just recorded. A view showing "live" has no other way to
      // learn that it no longer is.
      emit();
    },

    async start(concurrency) {
      // Omit the field so the server applies DEFAULT_BOARD_CONCURRENCY (2).
      // Sending an explicit 1 here would pin sequential mode by accident.
      await request(`/${encodeURIComponent(boardId)}/start`, {
        method: 'POST',
        body:
          concurrency === undefined
            ? JSON.stringify({})
            : JSON.stringify({ concurrency }),
      });
    },

    async stop() {
      await request(`/${encodeURIComponent(boardId)}/stop`, { method: 'POST' });
    },

    async setConcurrency(n) {
      await request(`/${encodeURIComponent(boardId)}/concurrency`, {
        method: 'POST',
        body: JSON.stringify({ n }),
      });
    },

    async startTask(taskId) {
      const response = await fetch(
        `/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(taskId)}/start`,
        { method: 'POST' },
      );
      // 409 means "not startable right now", which is an answer, not an error.
      return response.ok;
    },
  };
}
