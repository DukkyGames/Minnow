/**
 * P1-C — `/api/boards/*`. The engine's only public surface.
 *
 * Commands in by POST, events out by SSE. This endpoint set is what makes
 * "the renderer is a view" enforceable rather than aspirational: there is no
 * mutation verb the renderer can reach that is not a command the engine chose to
 * expose.
 *
 * | Method | Path                                | Purpose                                   |
 * | ------ | ----------------------------------- | ----------------------------------------- |
 * | POST   | `/api/boards`                       | Create from a plan path; 400 + ParseError[] |
 * | GET    | `/api/boards`                       | List                                      |
 * | GET    | `/api/boards/:id`                   | Current derived state                     |
 * | GET    | `/api/boards/:id/events`            | SSE stream                                |
 * | POST   | `/api/boards/:id/start`             | `{ concurrency }`                         |
 * | POST   | `/api/boards/:id/stop`              | —                                         |
 * | POST   | `/api/boards/:id/concurrency`       | `{ n }`                                   |
 * | POST   | `/api/boards/:id/tasks/:taskId/start` | Manual single-task start                |
 * | POST   | `/api/boards/:id/tasks/:taskId/abandon` | Manual abandon (P9-H)                 |
 * | POST   | `/api/boards/:id/model`             | `{ providerId, id, reasoning? }` (P9-C)   |
 * | GET    | `/api/boards/:id/attempts/:attemptId` | One attempt's transcript (P9-D)         |
 * | PATCH  | `/api/boards/:id`                   | `{ name }` — rename (P9-E)                |
 * | DELETE | `/api/boards/:id`                   | Delete the board and its journal (P9-E)   |
 * | GET    | `/api/boards/:id/journal`           | Raw events; `?since=<seq>&limit=<n>`      |
 *
 * **No endpoint accepts board state.** Every write above is a command the engine
 * chose to expose, and each one turns into a journal append the engine performs
 * — including the PATCH, which journals `board.renamed` rather than assigning a
 * field. DELETE is the one exception to "everything is a journal append", and it
 * is the opposite of a state write: it removes the journal outright.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { formatParseErrors, isParseErrors, parsePlan } from './core/parse-plan.js';
import { makeEvent } from './core/events.js';
import { stateToJSON } from './core/snapshot.js';
import { createScriptedEffector } from './effector-scripted.js';
import { disposeEngines, getEngine, peekEngine } from './engine.js';
import {
  appendEvent,
  boardExists,
  createBoard,
  deleteBoard,
  listBoards,
  loadState,
  readEvents,
} from './journal.js';
import { subscribeErrors, subscribeLive } from './live-events.js';
import { readTranscript } from './transcripts.js';
import { resolveSafePath } from '../runtime/path-access.js';

/** Heartbeat cadence. Intermediaries close idle streams without it. */
const HEARTBEAT_MS = 15_000;

/**
 * How a board's effector is built.
 *
 * The default stays scripted so the Phase 1 conformance suite needs no model.
 * Production calls {@link setEffectorFactory} from `server/runtime/middlewares.js`
 * with the runner effector (P2-F). Tests that need zero-model still inject
 * `createScriptedEffector`.
 *
 * The factory may receive the board id; scripted factories ignore it.
 *
 * @type {(boardId?: string) => import('./engine.js').Effector}
 */
let makeEffector = () => createScriptedEffector({});

/**
 * @param {() => import('./engine.js').Effector} factory
 * @returns {void}
 */
export function setEffectorFactory(factory) {
  makeEffector = factory;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('payload too large');
  }
  if (body.trim().length === 0) return {};
  return JSON.parse(body);
}

/**
 * Board state as JSON. `Map`s do not survive `JSON.stringify`, so the wire form
 * is the same canonical shape the snapshot uses — one serialisation, not two.
 *
 * @param {import('./core/types').BoardState} state
 * @returns {unknown}
 */
function serialiseState(state) {
  return stateToJSON(state);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * The route table, as data, so a test can enumerate it and assert nothing else
 * exists — in particular nothing that writes state.
 *
 * @type {Array<{ method: string, pattern: RegExp, name: string }>}
 */
export const ROUTES = [
  { method: 'POST', pattern: /^\/api\/boards$/, name: 'create' },
  { method: 'GET', pattern: /^\/api\/boards$/, name: 'list' },
  { method: 'GET', pattern: /^\/api\/boards\/([^/]+)$/, name: 'get' },
  { method: 'GET', pattern: /^\/api\/boards\/([^/]+)\/events$/, name: 'events' },
  { method: 'GET', pattern: /^\/api\/boards\/([^/]+)\/journal$/, name: 'journal' },
  { method: 'POST', pattern: /^\/api\/boards\/([^/]+)\/start$/, name: 'start' },
  { method: 'POST', pattern: /^\/api\/boards\/([^/]+)\/stop$/, name: 'stop' },
  { method: 'POST', pattern: /^\/api\/boards\/([^/]+)\/concurrency$/, name: 'concurrency' },
  {
    method: 'POST',
    pattern: /^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/start$/,
    name: 'startTask',
  },
  {
    method: 'POST',
    pattern: /^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/abandon$/,
    name: 'abandonTask',
  },
  { method: 'POST', pattern: /^\/api\/boards\/([^/]+)\/model$/, name: 'model' },
  {
    method: 'GET',
    pattern: /^\/api\/boards\/([^/]+)\/attempts\/([^/]+)$/,
    name: 'attempt',
  },
  { method: 'PATCH', pattern: /^\/api\/boards\/([^/]+)$/, name: 'rename' },
  { method: 'DELETE', pattern: /^\/api\/boards\/([^/]+)$/, name: 'delete' },
];

/**
 * @param {string} method
 * @param {string} pathname
 * @returns {{ name: string, params: string[] } | null}
 */
export function matchRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (match) return { name: route.name, params: match.slice(1).map(decodeURIComponent) };
  }
  return null;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleBoardsRequest(req, res, pathname) {
  const route = matchRoute(req.method ?? 'GET', pathname);
  if (!route) return false;

  try {
    await dispatch(route, req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) {
      // The SSE route writes its 200 before it can fail. Answering with a 500
      // here throws ERR_HTTP_HEADERS_SENT on top of the original error, and the
      // client then sees a crash rather than the failure that caused it. Say
      // what happened on the stream that is already open, and close it.
      console.warn(`[orchestrator] ${pathname} failed after the response began:`, message);
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      } catch {
        // The socket is gone; ending it is all that is left.
      }
      res.end();
      return true;
    }
    json(res, 500, { ok: false, error: message });
  }
  return true;
}

/**
 * @param {{ name: string, params: string[] }} route
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function dispatch(route, req, res) {
  const [boardId, taskId] = route.params;

  switch (route.name) {
    case 'list': {
      const ids = await listBoards();
      const boards = [];
      for (const id of ids) {
        const state = await loadState(id);
        boards.push({
          boardId: id,
          name: state.name,
          planPath: state.planPath,
          status: state.status,
          concurrency: state.concurrency,
          taskCount: state.tasks.size,
          finished: state.finished,
        });
      }
      return json(res, 200, { ok: true, boards });
    }

    case 'create':
      return createFromPlan(req, res);

    case 'get': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const engine = peekEngine(boardId);
      const state = engine ? engine.getState() : await loadState(boardId);
      return json(res, 200, { ok: true, state: serialiseState(state) });
    }

    case 'journal': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      // Journals are kept forever by design, so a timeline drawer that opens
      // against a six-hour run must be able to ask for a window rather than the
      // whole history. `since` is a `seq`, matching the SSE frame ids and
      // `Last-Event-ID`, so a view already holding events knows what to ask for.
      const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const since = Number(query.get('since'));
      const limit = Number(query.get('limit'));
      let events = await readEvents(boardId);
      if (Number.isSafeInteger(since) && since > 0) {
        events = events.filter((event) => Number(event.seq) > since);
      }
      // The window is the *most recent* `limit`: a drawer opening on a long run
      // wants the end of the story, not the beginning of it.
      const truncated = Number.isSafeInteger(limit) && limit > 0 && events.length > limit;
      if (truncated) events = events.slice(-limit);
      return json(res, 200, { ok: true, events, truncated });
    }

    case 'events':
      return streamEvents(req, res, boardId);

    case 'start': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const body = await readJsonBody(req);
      const concurrency = normaliseConcurrency(body.concurrency);
      if (concurrency === null) {
        return json(res, 400, { ok: false, error: 'concurrency must be an integer >= 1' });
      }
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      // P9-A. Refuse *before* answering. A missing model binding used to present
      // as "Start does nothing": the board went to `running`, every tick's
      // `effector.start()` rejected into a console.warn, and the only evidence
      // was a server log. A precondition that can be checked up front is checked
      // up front, so the failure lands on the button that caused it.
      try {
        await engine.preflight();
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          state: serialiseState(engine.getState()),
        });
      }
      await engine.startBoard(concurrency);
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'model': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const body = await readJsonBody(req);
      const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!providerId || !id) {
        return json(res, 400, { ok: false, error: 'providerId and id are required' });
      }
      // Only the two states `runTurn` actually understands. A free-form string
      // would journal a binding no attempt can honour, and the journal is not the
      // place to record something that will never happen.
      const reasoning = body.reasoning === 'on' || body.reasoning === 'off' ? body.reasoning : '';
      if (body.reasoning !== undefined && body.reasoning !== null && !reasoning) {
        return json(res, 400, { ok: false, error: "reasoning must be 'on' or 'off'" });
      }
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      await engine.setModel({ providerId, id, reasoning: reasoning || null });
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'rename': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const body = await readJsonBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return json(res, 400, { ok: false, error: 'name is required' });
      if (name.length > 200) return json(res, 400, { ok: false, error: 'name is too long' });
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      await engine.rename(name);
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'delete': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      // Dispose first. An engine left ticking would write the directory back the
      // moment its safety-net timer fired, and the board would come back from
      // the dead with a one-line journal.
      disposeEngines(boardId);
      const removed = await deleteBoard(boardId);
      return json(res, removed ? 200 : 404, {
        ok: removed,
        ...(removed ? { boardId } : { error: 'no such board' }),
      });
    }

    case 'attempt': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const limit = Number(query.get('limit'));
      // `taskId` is the second capture on this route; the attempt id rides in it.
      const transcript = await readTranscript(boardId, taskId, {
        ...(Number.isSafeInteger(limit) && limit > 0 ? { limit } : {}),
      });
      return json(res, 200, { ok: true, attemptId: taskId, ...transcript });
    }

    case 'stop': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      await engine.stopBoard('user');
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'concurrency': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const body = await readJsonBody(req);
      const n = normaliseConcurrency(body.n);
      if (n === null) return json(res, 400, { ok: false, error: 'n must be an integer >= 1' });
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      await engine.setConcurrency(n);
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'abandonTask': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      const abandoned = await engine.abandonTask(taskId, 'user');
      return json(res, abandoned ? 200 : 409, {
        ok: abandoned,
        ...(abandoned ? {} : { error: 'that task has already finished' }),
        state: serialiseState(engine.getState()),
      });
    }

    case 'startTask': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const engine = await getEngine(boardId, () => makeEffector(boardId));
      const started = await engine.startTask(taskId);
      return json(res, started ? 200 : 409, {
        ok: started,
        ...(started ? {} : { error: 'task is not startable right now' }),
        state: serialiseState(engine.getState()),
      });
    }

    default:
      return json(res, 404, { ok: false, error: 'no such route' });
  }
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normaliseConcurrency(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 64) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a board from a plan file.
 *
 * A plan that does not parse is a **400 with the `ParseError[]`**, not a 500 and
 * not a board with silently dropped tasks. The line numbers are the point.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function createFromPlan(req, res) {
  const body = await readJsonBody(req);
  const planPath = typeof body.planPath === 'string' ? body.planPath.trim() : '';
  if (!planPath) return json(res, 400, { ok: false, error: 'planPath is required' });

  /** @type {string} */
  let markdown;
  try {
    // Inline markdown is for tests and converters. Otherwise the path is
    // workspace-relative — `fs.readFile(planPath)` against process.cwd() is
    // why typing documentation/plans/… failed whenever the workspace was not
    // the server's working directory.
    markdown =
      typeof body.markdown === 'string'
        ? body.markdown
        : await fs.readFile(resolveSafePath(planPath), 'utf8');
  } catch (err) {
    return json(res, 400, {
      ok: false,
      error: `could not read plan: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const parsed = parsePlan(markdown);
  if (isParseErrors(parsed)) {
    return json(res, 400, {
      ok: false,
      error: 'the plan does not parse',
      errors: parsed,
      detail: formatParseErrors(parsed),
    });
  }

  const boardId = deriveBoardId(body.boardId, parsed.name, planPath);
  if (await boardExists(boardId)) {
    return json(res, 409, { ok: false, error: `board ${boardId} already exists` });
  }

  await createBoard(boardId);
  await appendEvent(
    boardId,
    makeEvent('board.created', {
      boardId,
      planPath,
      name: parsed.name,
      tasks: parsed.tasks,
      waves: parsed.waves,
    }),
  );

  const state = await loadState(boardId);
  return json(res, 201, { ok: true, boardId, state: serialiseState(state) });
}

/**
 * @param {unknown} requested
 * @param {string} planName
 * @param {string} planPath
 * @returns {string}
 */
function deriveBoardId(requested, planName, planPath) {
  const raw =
    (typeof requested === 'string' && requested.trim()) ||
    planName ||
    path.basename(planPath).replace(/\.md$/i, '');
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'board';
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/**
 * Stream a board's events.
 *
 * On connect the client gets one `snapshot` frame carrying the current derived
 * state and the `seq` it is current as of, then every subsequent event. A client
 * that reconnects sends `Last-Event-ID` and receives exactly the tail from that
 * `seq` — **never a re-fold from event zero**.
 *
 * Every frame's `id:` is the event `seq`, which is what makes `Last-Event-ID`
 * work with no extra bookkeeping.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} boardId
 * @returns {Promise<void>}
 */
async function streamEvents(req, res, boardId) {
  if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const lastEventId = Number(req.headers['last-event-id']);
  const resumeFrom = Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : 0;

  /**
   * @param {string} type
   * @param {unknown} data
   * @param {number} [id]
   */
  const send = (type, data, id) => {
    let frame = '';
    if (id !== undefined) frame += `id: ${id}\n`;
    frame += `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      res.write(frame);
      return true;
    } catch {
      return false;
    }
  };

  const engine = await getEngine(boardId, () => makeEffector(boardId));

  // Subscribe *before* taking the baseline, buffering whatever arrives while it
  // is being taken. Reading first and subscribing after leaves a window — today
  // it happens to be free of `await`s, but that is a property of the current
  // code rather than of the design, and an event dropped there is not recovered
  // by anything: the client would sit on a permanently stale board.
  /** @type {Record<string, unknown>[]} */
  let buffered = [];
  /** Highest seq already sent. -1 until the baseline is established. */
  let sentThrough = -1;

  const deliver = (event) => {
    const seq = Number(event.seq) || 0;
    if (sentThrough < 0) {
      buffered.push(event);
      return;
    }
    if (seq <= sentThrough) return; // already covered by the baseline
    sentThrough = seq;
    if (!send('event', event, seq)) cleanup();
  };
  const unsubscribe = engine.subscribe(deliver);
  // Live tokens/tools are a parallel stream, not journal lines. No `id:` so a
  // reconnect's Last-Event-ID cannot skip a real event or treat a token as one.
  const unsubscribeLive = subscribeLive(boardId, (payload) => {
    if (!send('live', payload)) cleanup();
  });
  // P9-A. Failures that stop work from *starting* are deliberately not journaled
  // — a start that never happened is not a completed side effect, and putting it
  // in the fold would make replay disagree with reality. No `id:` either, for the
  // same reason as `live`: a reconnect must not treat one as a journal seq.
  const unsubscribeErrors = subscribeErrors(boardId, (payload) => {
    if (!send('error', payload)) cleanup();
  });

  if (resumeFrom > 0) {
    // Resuming: just the tail the client missed.
    const events = await readEvents(boardId);
    let highest = resumeFrom;
    for (const event of events) {
      const seq = Number(event.seq) || 0;
      if (seq <= resumeFrom) continue;
      send('event', event, seq);
      if (seq > highest) highest = seq;
    }
    sentThrough = highest;
  } else {
    // `seq` and `state` come from the engine together. Deriving the seq from a
    // separate journal read could claim the snapshot is current as of an event
    // the state does not contain, and a reconnect would then skip it forever.
    const state = engine.getState();
    const seq = engine.getHighestSeq();
    send('snapshot', { seq, state: serialiseState(state) }, seq);
    sentThrough = seq;
  }

  // Flush what arrived while the baseline was being taken. Synchronous, so no
  // further event can interleave with it.
  const pending = buffered;
  buffered = [];
  for (const event of pending) deliver(event);

  // Whatever is failing to start right now, for a client that connected after
  // the frame that said so. Error frames are live-only, so without this a window
  // opened mid-failure shows a board reading `running` with nothing happening and
  // no explanation — the exact symptom P9-A exists to abolish.
  for (const failure of engine.getStartFailures()) {
    send('error', {
      boardId,
      taskId: failure.taskId,
      role: failure.role,
      message: failure.message,
      consecutive: failure.consecutive,
    });
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);

  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    // Drop the subscription *and* the reference to the response, so a dead
    // socket cannot keep the board's event stream alive through this closure.
    unsubscribe();
    unsubscribeLive();
    unsubscribeErrors();
    try {
      res.end();
    } catch {
      // Already gone.
    }
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

// ---------------------------------------------------------------------------

/** Connect-style middleware. */
export function createBoardsMiddleware() {
  return async (
    /** @type {import('node:http').IncomingMessage} */ req,
    /** @type {import('node:http').ServerResponse} */ res,
    /** @type {() => void} */ next,
  ) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (!pathname.startsWith('/api/boards')) {
      next();
      return;
    }
    const handled = await handleBoardsRequest(req, res, pathname);
    if (!handled) next();
  };
}

export { disposeEngines };
