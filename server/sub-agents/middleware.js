/**
 * P8-F — `/api/agents/*`. The sub-agent engine's only public surface.
 *
 * Commands in by POST, events out by SSE. This is what makes "the renderer
 * is a view" enforceable: there is no mutation verb the renderer can reach
 * that is not a command the engine chose to expose. Spawn and cancel are
 * POSTs; everything else is a read.
 *
 * | Method | Path                              | Purpose                              |
 * | ------ | --------------------------------- | ------------------------------------ |
 * | POST   | `/api/agents`                     | spawn                                |
 * | GET    | `/api/agents?parentChatId=`       | derived state for one chat           |
 * | GET    | `/api/agents/:runId`              | one run                              |
 * | GET    | `/api/agents/:runId/events`       | SSE: journal frames + live + error   |
 * | GET    | `/api/agents/:runId/journal`      | raw parent journal (debug)           |
 * | POST   | `/api/agents/:runId/cancel`       | cancel                               |
 *
 * Live tokens ride `event: live` (opaque key, P8-B) and are never journaled.
 * Failures after 200 go out as `event: error` — a counter, not a toast per tick.
 *
 * P9-A at this boundary: POST spawn resolves the model binding and the
 * effector's preconditions *before* it answers. An unresolvable model is a
 * 400 at the spawn site, not a silent tick loop.
 */

import { randomUUID } from 'node:crypto';

import { AGENTS_NAMESPACE, isTerminal, stateToJSON } from './derive.js';
import { makeEvent } from './events.js';
import { createSubAgentGraph } from './graph.js';
import { getSubAgentTypeRow, loadSubAgentFile } from './config.js';
import {
  listEntries,
  loadState,
  readEvents,
  resetJournalCache,
} from './journal.js';
import * as agentsJournal from './journal.js';
import { createSubAgentEffector } from './effector-runner.js';
import { disposeEngines, getEngine, peekEngine } from '../orchestrator/engine.js';
import {
  subscribeDeliver,
  subscribeErrors,
  subscribeLive,
} from '../orchestrator/live-events.js';
import { getProductionDelivery } from './runtime.js';
import { safeSegment } from '../orchestrator/journal-store.js';

/** Heartbeat cadence. Intermediaries close idle streams without it. */
const HEARTBEAT_MS = 15_000;

/** Commands that write the journal. Reads stay available for a stale view. */
const MUTATING_ROUTES = new Set(['spawn', 'cancel']);

/**
 * How a parent-chat's effector is built.
 *
 * Tests inject a scripted / fake-host effector. Production
 * `setAgentsEffectorFactory` from `server/runtime/middlewares.js` supplies
 * `createSubAgentEffector`.
 *
 * @type {(parentChatId: string) => import('../orchestrator/engine.js').Effector}
 */
let makeEffector = (parentChatId) => createSubAgentEffector({ parentChatId });

/**
 * @param {(parentChatId: string) => import('../orchestrator/engine.js').Effector} factory
 * @returns {void}
 */
export function setAgentsEffectorFactory(factory) {
  makeEffector = factory;
}

/** Parent chats whose engine already has a delivery subscriber. */
const deliveryWired = new Set();

/**
 * @param {Record<string, unknown>} file
 * @returns {import('./types').Caps}
 */
function capsFromFile(file) {
  /** @type {Record<string, number>} */
  const byType = {};
  const types =
    file.types && typeof file.types === 'object'
      ? /** @type {Record<string, Record<string, unknown>>} */ (file.types)
      : {};
  for (const [id, row] of Object.entries(types)) {
    if (row && typeof row.maxConcurrent === 'number') {
      byType[id] = row.maxConcurrent;
    }
  }
  return {
    globalMaxConcurrent:
      typeof file.globalMaxConcurrent === 'number' ? file.globalMaxConcurrent : 3,
    maxConcurrentByType: byType,
  };
}

/**
 * The live engine for one parent chat. Namespace `'agents'`, this directory's
 * graph and journal — never the board defaults.
 *
 * @param {string} parentChatId
 * @returns {Promise<import('../orchestrator/engine.js').Engine>}
 */
export async function getAgentsEngine(parentChatId) {
  const file = await loadSubAgentFile();
  const engine = await getEngine(parentChatId, () => makeEffector(parentChatId), {
    namespace: AGENTS_NAMESPACE,
    graph: createSubAgentGraph(capsFromFile(file)),
    journal: agentsJournal,
  });
  if (!deliveryWired.has(parentChatId)) {
    deliveryWired.add(parentChatId);
    // A terminal append is what makes a run pending. Tick delivery then,
    // not on a timer — the fold is the queue.
    engine.subscribe((event) => {
      const type = event?.type;
      if (type === 'attempt.ended' || type === 'run.abandoned' || type === 'run.cancelled') {
        void getProductionDelivery().tick(parentChatId);
      }
    });
  }
  return engine;
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
 * @param {import('./types').RunState} run
 * @returns {Record<string, unknown>}
 */
function runToJSON(run) {
  const state = stateToJSON({
    parentChatId: run.parentChatId,
    status: 'idle',
    runs: new Map([[run.runId, run]]),
    runOrder: [run.runId],
  });
  const runs = /** @type {Array<Record<string, unknown>>} */ (state.runs);
  return runs[0] ?? { runId: run.runId };
}

/**
 * Product status the drawer already understands. Phase is the fold; this
 * is a view mapping, not a second state machine.
 *
 * @param {import('./types').RunState} run
 * @returns {'queued' | 'running' | 'completed' | 'failed' | 'cancelled'}
 */
export function statusFromPhase(run) {
  if (run.phase === 'passed') return 'completed';
  if (run.phase === 'cancelled') return 'cancelled';
  if (run.phase === 'abandoned') return 'failed';
  if (run.phase === 'running') return 'running';
  return 'queued';
}

/**
 * Scan parent journals for a run id. The journal is per chat, the URL is
 * per run — this join is the cost of that shape.
 *
 * @param {string} runId
 * @returns {Promise<{ parentChatId: string, run: import('./types').RunState, state: import('./types').AgentsState } | null>}
 */
async function findRun(runId) {
  const ids = await listEntries();
  for (const parentChatId of ids) {
    const engine = peekEngine(parentChatId, AGENTS_NAMESPACE);
    const state = engine
      ? /** @type {import('./types').AgentsState} */ (engine.getState())
      : await loadState(parentChatId);
    const run = state.runs.get(runId);
    if (run) return { parentChatId, run, state };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * @type {Array<{ method: string, pattern: RegExp, name: string }>}
 */
export const ROUTES = [
  { method: 'POST', pattern: /^\/api\/agents$/, name: 'spawn' },
  { method: 'GET', pattern: /^\/api\/agents$/, name: 'list' },
  { method: 'GET', pattern: /^\/api\/agents\/([^/]+)\/events$/, name: 'events' },
  { method: 'GET', pattern: /^\/api\/agents\/([^/]+)\/journal$/, name: 'journal' },
  { method: 'POST', pattern: /^\/api\/agents\/([^/]+)\/cancel$/, name: 'cancel' },
  { method: 'GET', pattern: /^\/api\/agents\/([^/]+)$/, name: 'get' },
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
export async function handleAgentsRequest(req, res, pathname) {
  const route = matchRoute(req.method ?? 'GET', pathname);
  if (!route) return false;

  try {
    await dispatch(route, req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) {
      console.warn(`[agents] ${pathname} failed after the response began:`, message);
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      } catch {
        // The socket is gone.
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
  const [runId] = route.params;

  switch (route.name) {
    case 'list': {
      const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const parentChatId = (query.get('parentChatId') ?? '').trim();
      if (!parentChatId) {
        return json(res, 400, { ok: false, error: 'parentChatId is required' });
      }
      try {
        safeSegment(parentChatId, 'parentChat');
      } catch (err) {
        return json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const engine = peekEngine(parentChatId, AGENTS_NAMESPACE);
      const state = engine
        ? /** @type {import('./types').AgentsState} */ (engine.getState())
        : await loadState(parentChatId);
      const seq = engine
        ? engine.getHighestSeq()
        : (await readEvents(parentChatId)).reduce((h, e) => {
            const n = Number(e.seq);
            return Number.isSafeInteger(n) && n > h ? n : h;
          }, 0);
      return json(res, 200, {
        ok: true,
        parentChatId,
        seq,
        state: stateToJSON(state),
      });
    }

    case 'spawn':
      return spawnRun(req, res);

    case 'get': {
      const found = await findRun(runId);
      if (!found) return json(res, 404, { ok: false, error: 'no such run' });
      const engine = peekEngine(found.parentChatId, AGENTS_NAMESPACE);
      const seq = engine ? engine.getHighestSeq() : Number((await readEvents(found.parentChatId)).at(-1)?.seq) || 0;
      return json(res, 200, {
        ok: true,
        parentChatId: found.parentChatId,
        seq,
        run: runToJSON(found.run),
        status: statusFromPhase(found.run),
      });
    }

    case 'journal': {
      const found = await findRun(runId);
      if (!found) return json(res, 404, { ok: false, error: 'no such run' });
      const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const since = Number(query.get('since'));
      const limit = Number(query.get('limit'));
      let events = await readEvents(found.parentChatId);
      if (Number.isSafeInteger(since) && since > 0) {
        events = events.filter((event) => Number(event.seq) > since);
      }
      const truncated = Number.isSafeInteger(limit) && limit > 0 && events.length > limit;
      if (truncated) events = events.slice(-limit);
      return json(res, 200, {
        ok: true,
        parentChatId: found.parentChatId,
        events,
        truncated,
      });
    }

    case 'events':
      return streamEvents(req, res, runId);

    case 'cancel': {
      const found = await findRun(runId);
      if (!found) return json(res, 404, { ok: false, error: 'no such run' });
      if (isTerminal(found.run)) {
        return json(res, 200, {
          ok: true,
          runId,
          status: statusFromPhase(found.run),
        });
      }
      const engine = await getAgentsEngine(found.parentChatId);
      await engine.append([makeEvent('run.cancelled', { runId, reason: 'user' })]);
      await engine.tick();
      const after = /** @type {import('./types').AgentsState} */ (engine.getState());
      const run = after.runs.get(runId);
      return json(res, 200, {
        ok: true,
        runId,
        status: run ? statusFromPhase(run) : 'cancelled',
        state: stateToJSON(after),
      });
    }

    default:
      return json(res, 404, { ok: false, error: 'no such route' });
  }
}

/**
 * P9-A at spawn: preflight *before* answering. A missing model used to
 * present as a silent tick loop. Failures after 200 still go out as
 * `event: error` frames (a counter, not one toast per tick).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function spawnRun(req, res) {
  const body = await readJsonBody(req);
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const task = typeof body.task === 'string' ? body.task.trim() : '';
  const parentChatId = typeof body.parentChatId === 'string' ? body.parentChatId.trim() : '';
  const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';

  if (!type) return json(res, 400, { ok: false, error: 'type is required' });
  if (!task) return json(res, 400, { ok: false, error: 'task is required' });
  if (!parentChatId) return json(res, 400, { ok: false, error: 'parentChatId is required' });
  if (!cwd) {
    return json(res, 400, {
      ok: false,
      error: 'cwd is required (the spawning chat\'s workspace; no silent default)',
    });
  }
  try {
    safeSegment(parentChatId, 'parentChat');
  } catch (err) {
    return json(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const file = await loadSubAgentFile();
  if (file.enabled === false) {
    return json(res, 400, { ok: false, error: 'sub-agents are disabled in sub-agents.json' });
  }
  const typeRow = await getSubAgentTypeRow(type);
  if (!typeRow) {
    return json(res, 400, {
      ok: false,
      error: `unknown or disabled sub-agent type "${type}"`,
    });
  }

  const runId =
    typeof body.runId === 'string' && body.runId.trim() ? body.runId.trim() : randomUUID();
  try {
    safeSegment(runId, 'run');
  } catch (err) {
    return json(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const engine = await getAgentsEngine(parentChatId);

  // Validate at the command boundary — P9-A. Do not append run.requested
  // until the effector can actually start work.
  try {
    await engine.preflight();
  } catch (err) {
    return json(res, 400, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const existing = /** @type {import('./types').AgentsState} */ (engine.getState()).runs.get(runId);
  if (existing) {
    return json(res, 409, { ok: false, error: `run ${runId} already exists` });
  }

  const parentTurnId = typeof body.parentTurnId === 'string' ? body.parentTurnId.trim() : '';
  const parentToolCallId =
    typeof body.parentToolCallId === 'string' ? body.parentToolCallId.trim() : '';
  const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';

  /** @type {Record<string, unknown>} */
  const payload = {
    runId,
    agentType: type,
    task,
    parentChatId,
    cwd,
    requestedAt: Date.now(),
  };
  if (parentTurnId) payload.parentTurnId = parentTurnId;
  if (parentToolCallId) payload.parentToolCallId = parentToolCallId;
  if (providerId && modelId) payload.model = { providerId, id: modelId };

  await engine.append([makeEvent('run.requested', payload)]);
  await engine.tick();

  const state = /** @type {import('./types').AgentsState} */ (engine.getState());
  const run = state.runs.get(runId);
  return json(res, 201, {
    ok: true,
    runId,
    status: run ? statusFromPhase(run) : 'queued',
    run: run ? runToJSON(run) : null,
    state: stateToJSON(state),
  });
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/**
 * Stream one run's events.
 *
 * Snapshot + journal frames carry `seq`. Live tokens and start-failures do
 * not — a reconnect must not treat a token as a journal id, and must not
 * replay a completed run's tokens (there are none on the journal).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} runId
 * @returns {Promise<void>}
 */
async function streamEvents(req, res, runId) {
  const found = await findRun(runId);
  if (!found) return json(res, 404, { ok: false, error: 'no such run' });
  const { parentChatId } = found;

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

  const engine = await getAgentsEngine(parentChatId);

  /** @type {Record<string, unknown>[]} */
  let buffered = [];
  let sentThrough = -1;

  const forThisRun = (event) => {
    if (!event || typeof event !== 'object') return false;
    const rec = /** @type {Record<string, unknown>} */ (event);
    if (rec.type === 'run.requested' || rec.runId === runId) return rec.runId === runId;
    return rec.runId === runId;
  };

  const deliver = (event) => {
    if (!forThisRun(event)) return;
    const seq = Number(event.seq) || 0;
    if (sentThrough < 0) {
      buffered.push(event);
      return;
    }
    if (seq <= sentThrough) return;
    sentThrough = seq;
    if (!send('event', event, seq)) cleanup();
  };
  const unsubscribe = engine.subscribe(deliver);
  const unsubscribeLive = subscribeLive(parentChatId, (payload) => {
    if (payload.taskId !== runId) return;
    if (!send('live', payload)) cleanup();
  });
  const unsubscribeErrors = subscribeErrors(parentChatId, (payload) => {
    if (payload.taskId !== runId) return;
    if (!send('error', payload)) cleanup();
  });
  const unsubscribeDeliver = subscribeDeliver(parentChatId, (payload) => {
    if (!Array.isArray(payload.runIds) || !payload.runIds.includes(runId)) return;
    if (!send('deliver', payload)) cleanup();
  });

  if (resumeFrom > 0) {
    const events = await readEvents(parentChatId);
    let highest = resumeFrom;
    for (const event of events) {
      if (!forThisRun(event)) continue;
      const seq = Number(event.seq) || 0;
      if (seq <= resumeFrom) continue;
      send('event', event, seq);
      if (seq > highest) highest = seq;
    }
    sentThrough = highest;
  } else {
    const state = /** @type {import('./types').AgentsState} */ (engine.getState());
    const seq = engine.getHighestSeq();
    const run = state.runs.get(runId);
    send(
      'snapshot',
      {
        seq,
        parentChatId,
        run: run ? runToJSON(run) : null,
        status: run ? statusFromPhase(run) : null,
      },
      seq,
    );
    sentThrough = seq;
  }

  const pending = buffered;
  buffered = [];
  for (const event of pending) deliver(event);

  for (const failure of engine.getStartFailures()) {
    if (failure.taskId !== runId) continue;
    send('error', {
      boardId: parentChatId,
      key: parentChatId,
      taskId: failure.taskId,
      role: failure.role,
      message: failure.message,
      consecutive: failure.consecutive,
    });
  }

  // A newly connected view can take pending completions. Tick after
  // subscribeDeliver so productionDeliver sees a listener.
  void getProductionDelivery().tick(parentChatId);

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
    unsubscribe();
    unsubscribeLive();
    unsubscribeErrors();
    unsubscribeDeliver();
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

/** Connect-style middleware. */
export function createAgentsMiddleware() {
  return async (
    /** @type {import('node:http').IncomingMessage} */ req,
    /** @type {import('node:http').ServerResponse} */ res,
    /** @type {() => void} */ next,
  ) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (!pathname.startsWith('/api/agents')) {
      next();
      return;
    }
    const handled = await handleAgentsRequest(req, res, pathname);
    if (!handled) next();
  };
}

/** Tests: drop engine registry + delivery wiring. */
export function resetAgentsMiddlewareForTests() {
  deliveryWired.clear();
  disposeEngines(undefined, AGENTS_NAMESPACE);
  resetJournalCache();
}

export { MUTATING_ROUTES, disposeEngines };
