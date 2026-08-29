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
 */

import { foldInto } from '../../server/orchestrator/core/derive.js';
import { stateFromJSON } from '../../server/orchestrator/core/snapshot.js';
import type { BoardState, ParseError } from '../../server/orchestrator/core/types';

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

export interface BoardClient {
  readonly boardId: string;
  /** The current derived state, or null before the first frame arrives. */
  getState(): BoardState | null;
  /** True while the SSE stream is open. */
  isConnected(): boolean;
  /** Notified on every state change, including connection changes. */
  subscribe(listener: (state: BoardState | null) => void): () => void;
  connect(): void;
  close(): void;

  // Commands. Each is a POST; none of them touches local state directly.
  start(concurrency: number): Promise<void>;
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

/** The raw journal, for the timeline drawer and for debugging. */
export async function readJournal(boardId: string): Promise<Record<string, unknown>[]> {
  const body = await request(`/${encodeURIComponent(boardId)}/journal`);
  return body.events ?? [];
}

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
  let state: BoardState | null = null;
  let source: EventStream | null = null;
  let connected = false;
  const listeners = new Set<(state: BoardState | null) => void>();

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[orchestrator] board subscriber threw', err);
      }
    }
  };

  const onSnapshot = (event: { data: string }) => {
    try {
      const payload = JSON.parse(event.data);
      state = stateFromJSON(payload.state);
      emit();
    } catch (err) {
      console.error('[orchestrator] could not read the board snapshot', err);
    }
  };

  const onEvent = (event: { data: string }) => {
    try {
      const journalEvent = JSON.parse(event.data);
      if (!state) return; // The snapshot has not arrived yet; it will include this.
      // The same fold the server runs. There is no second interpretation of an
      // event anywhere in the system.
      foldInto(state, [journalEvent]);
      emit();
    } catch (err) {
      console.error('[orchestrator] could not fold a board event', err);
    }
  };

  return {
    boardId,

    getState: () => state,
    isConnected: () => connected,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    connect() {
      if (source) return;
      source = openStream(`/api/boards/${encodeURIComponent(boardId)}/events`);
      source.addEventListener('snapshot', onSnapshot);
      source.addEventListener('event', onEvent);
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
      connected = false;
    },

    async start(concurrency) {
      await request(`/${encodeURIComponent(boardId)}/start`, {
        method: 'POST',
        body: JSON.stringify({ concurrency }),
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
