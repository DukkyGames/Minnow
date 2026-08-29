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
 * | GET    | `/api/boards/:id/journal`           | Raw events                                |
 *
 * **No PUT, no PATCH, and no endpoint that accepts board state.** The only
 * writes are the commands above.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { formatParseErrors, isParseErrors, parsePlan } from './core/parse-plan.js';
import { makeEvent } from './core/events.js';
import { stateToJSON } from './core/snapshot.js';
import { createScriptedEffector } from './effector-scripted.js';
import { disposeEngines, getEngine, peekEngine } from './engine.js';
import { appendEvent, boardExists, createBoard, listBoards, loadState, readEvents } from './journal.js';

/** Heartbeat cadence. Intermediaries close idle streams without it. */
const HEARTBEAT_MS = 15_000;

/**
 * How a board's effector is built.
 *
 * Phase 1 ships the scripted one — the scheduler is proven with zero model
 * calls before real agents are attached. P2-F swaps this for the runner
 * effector, and nothing else in this file changes.
 *
 * @type {() => import('./engine.js').Effector}
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
      return json(res, 200, { ok: true, events: await readEvents(boardId) });
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
      const engine = await getEngine(boardId, makeEffector);
      await engine.startBoard(concurrency);
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'stop': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const engine = await getEngine(boardId, makeEffector);
      await engine.stopBoard('user');
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'concurrency': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const body = await readJsonBody(req);
      const n = normaliseConcurrency(body.n);
      if (n === null) return json(res, 400, { ok: false, error: 'n must be an integer >= 1' });
      const engine = await getEngine(boardId, makeEffector);
      await engine.setConcurrency(n);
      return json(res, 200, { ok: true, state: serialiseState(engine.getState()) });
    }

    case 'startTask': {
      if (!(await boardExists(boardId))) return json(res, 404, { ok: false, error: 'no such board' });
      const engine = await getEngine(boardId, makeEffector);
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
    markdown = typeof body.markdown === 'string' ? body.markdown : await fs.readFile(planPath, 'utf8');
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

  const engine = await getEngine(boardId, makeEffector);

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
