/**
 * HTTP routes for blind model compare (/api/compare).
 */

import { validateProviderId } from '../providers/validate.js';
import { readConfigJson } from '../config/store.js';
import { listProviders } from '../providers/store.js';
import { resolveFallbackChain } from '../generations/fallback.js';
import {
  addSubscriber,
  createGenerationState,
  getGenerationState,
  removeSubscriber,
} from '../generations/store.js';
import { pumpUpstream } from '../generations/upstream.js';
import {
  activateSlotGeneration,
  assignPickGenerations,
  createSession,
  deleteSession,
  getSession,
  getSessionPublic,
  listHistory,
  loadPersistedSessions,
  recordVote,
  resolveStreamSlotIndex,
} from './store.js';

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_SLOTS = 2;
const MAX_SLOTS = 6;

let storeLoaded = false;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {unknown} value
 * @returns {{ providerId: string; modelId: string } | null}
 */
function parseModelRef(value) {
  if (!value || typeof value !== 'object') return null;
  const row = /** @type {{ providerId?: unknown; modelId?: unknown }} */ (value);
  const providerId =
    typeof row.providerId === 'string' ? validateProviderId(row.providerId) : null;
  const modelId = typeof row.modelId === 'string' ? row.modelId.trim() : '';
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

/**
 * @param {unknown} payload
 * @returns {{ picks: { providerId: string; modelId: string }[]; parallel: boolean } | { error: string }}
 */
function parseStartPayload(payload) {
  const parallel = payload.parallel !== false;

  if (Array.isArray(payload.models)) {
    const picks = payload.models.map(parseModelRef);
    if (picks.some((pick) => !pick)) {
      return { error: 'Each model entry needs providerId and modelId' };
    }
    if (picks.length < MIN_SLOTS || picks.length > MAX_SLOTS) {
      return { error: `Provide ${MIN_SLOTS}–${MAX_SLOTS} models` };
    }
    return { picks, parallel };
  }

  const pickLeft = parseModelRef(payload.left);
  const pickRight = parseModelRef(payload.right);
  if (!pickLeft || !pickRight) {
    return { error: 'models[] or left/right provider/model are required' };
  }
  return { picks: [pickLeft, pickRight], parallel };
}

/**
 * @param {string} providerId
 * @param {string} modelId
 * @param {string} prompt
 * @param {unknown} sampler
 * @returns {Promise<string>}
 */
async function startCompareGeneration(providerId, modelId, prompt, sampler) {
  /** @type {Record<string, unknown>} */
  const body = {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  };

  if (sampler && typeof sampler === 'object' && !Array.isArray(sampler)) {
    const s = /** @type {Record<string, unknown>} */ (sampler);
    for (const [key, val] of Object.entries(s)) {
      if (key !== 'model' && key !== 'messages' && key !== 'stream') {
        body[key] = val;
      }
    }
  }

  const config = (await readConfigJson('config.json')) ?? {};
  const { providers } = await listProviders();
  const enabledProviderIds = new Set(
    providers.filter((p) => p.enabled !== false).map((p) => p.id),
  );
  const candidates = resolveFallbackChain({
    role: 'default',
    primaryProviderId: providerId,
    primaryModelId: modelId,
    config,
    enabledProviderIds,
  });

  const state = createGenerationState({
    providerId,
    body,
    persist: false,
    candidates,
  });
  pumpUpstream({ state });
  return state.id;
}

/**
 * Start generations after blind slot assignment exists on the session.
 *
 * @param {import('./store.js').CompareSession} session
 * @param {unknown} sampler
 */
async function kickoffSessionGenerations(session, sampler) {
  const pickCount = Math.max(...session.slots.map((slot) => slot.pickIndex)) + 1;
  /** @type {import('./store.js').CompareModelRef[]} */
  const picksByUserOrder = Array(pickCount);
  for (const slot of session.slots) {
    picksByUserOrder[slot.pickIndex] = slot.model;
  }

  if (session.parallel) {
    const started = await Promise.all(
      picksByUserOrder.map((pick) =>
        startCompareGeneration(pick.providerId, pick.modelId, session.prompt, sampler),
      ),
    );
    assignPickGenerations(session.id, started);
    return;
  }

  const firstSlot = session.slots.find((slot) => slot.screenIndex === 0);
  if (!firstSlot) return;
  const generationId = await startCompareGeneration(
    firstSlot.model.providerId,
    firstSlot.model.modelId,
    session.prompt,
    sampler,
  );
  activateSlotGeneration(session.id, 0, generationId);
}

/**
 * @param {import('./store.js').CompareSession} session
 * @returns {object}
 */
function buildStartResponse(session) {
  const slots = session.slots.map((slot) => ({
    generationId: slot.generationId,
    label: slot.alias,
    activated: slot.activated,
  }));
  const payload = {
    sessionId: session.id,
    parallel: session.parallel,
    slots,
  };
  if (session.slots.length === 2) {
    payload.left = slots[0];
    payload.right = slots[1];
  }
  return payload;
}

/**
 * Proxy a generation SSE stream for a compare column.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} generationId
 * @returns {boolean}
 */
function pipeGenerationStream(req, res, generationId) {
  const state = getGenerationState(generationId);
  if (!state) {
    sendJson(res, 404, { error: 'Generation not found' });
    return true;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  addSubscriber(state, res);
  const onClientDisconnect = () => {
    removeSubscriber(state, res);
    if (!res.writableEnded && !res.destroyed) {
      res.destroy();
    }
  };
  req.on('close', onClientDisconnect);
  req.on('aborted', onClientDisconnect);
  res.on('close', onClientDisconnect);
  return true;
}

async function ensureStoreLoaded() {
  if (!storeLoaded) {
    await loadPersistedSessions();
    storeLoaded = true;
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleCompareRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/compare')) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  await ensureStoreLoaded();

  try {
    if (pathname === '/api/compare/start' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
      if (!prompt) {
        sendJson(res, 400, { error: 'prompt is required' });
        return true;
      }

      const parsed = parseStartPayload(payload);
      if ('error' in parsed) {
        sendJson(res, 400, { error: parsed.error });
        return true;
      }

      const session = createSession({
        prompt,
        picks: parsed.picks,
        generationIds: parsed.picks.map(() => ''),
        parallel: parsed.parallel,
      });

      await kickoffSessionGenerations(session, payload.sampler);

      const refreshed = getSession(session.id) ?? session;
      sendJson(res, 201, buildStartResponse(refreshed));
      return true;
    }

    if (pathname === '/api/compare/history' && req.method === 'GET') {
      const url = new URL(req.url ?? '', 'http://localhost');
      const limitRaw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
      const history = await listHistory(limit);
      sendJson(res, 200, history);
      return true;
    }

    const activateMatch = pathname.match(/^\/api\/compare\/([^/]+)\/activate-slot\/(\d+)$/);
    if (activateMatch && req.method === 'POST') {
      const sessionId = activateMatch[1];
      const screenIndex = Number(activateMatch[2]);
      if (!SESSION_ID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return true;
      }
      const session = getSession(sessionId);
      if (!session) {
        sendJson(res, 404, { error: 'Session not found' });
        return true;
      }
      const slot = session.slots.find((row) => row.screenIndex === screenIndex);
      if (!slot) {
        sendJson(res, 400, { error: 'Invalid slot index' });
        return true;
      }
      if (slot.activated && slot.generationId) {
        sendJson(res, 200, {
          generationId: slot.generationId,
          label: slot.alias,
          activated: true,
        });
        return true;
      }

      const payload = await readJsonBody(req);
      const sampler = payload.sampler;
      const generationId = await startCompareGeneration(
        slot.model.providerId,
        slot.model.modelId,
        session.prompt,
        sampler,
      );
      const result = activateSlotGeneration(sessionId, screenIndex, generationId);
      if ('error' in result) {
        sendJson(res, 404, { error: result.error });
        return true;
      }
      sendJson(res, 201, {
        generationId: result.slot.generationId,
        label: result.slot.alias,
        activated: true,
      });
      return true;
    }

    const streamMatch = pathname.match(/^\/api\/compare\/([^/]+)\/stream\/([^/]+)$/);
    if (streamMatch && req.method === 'GET') {
      const sessionId = streamMatch[1];
      const streamKey = streamMatch[2];
      if (!SESSION_ID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return true;
      }
      const session = getSession(sessionId);
      if (!session) {
        sendJson(res, 404, { error: 'Session not found' });
        return true;
      }
      const slotIndex = resolveStreamSlotIndex(session, streamKey);
      if (slotIndex === null) {
        sendJson(res, 400, { error: 'Invalid stream side' });
        return true;
      }
      const slot = session.slots.find((row) => row.screenIndex === slotIndex);
      if (!slot?.generationId) {
        sendJson(res, 409, { error: 'Slot generation not started yet' });
        return true;
      }
      return pipeGenerationStream(req, res, slot.generationId);
    }

    const voteMatch = pathname.match(/^\/api\/compare\/([^/]+)\/vote$/);
    if (voteMatch && req.method === 'POST') {
      const sessionId = voteMatch[1];
      if (!SESSION_ID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return true;
      }
      const payload = await readJsonBody(req);
      let winner = payload.winner;
      if (typeof winner === 'string' && /^\d+$/.test(winner)) {
        winner = Number(winner);
      }
      if (
        winner !== 'left' &&
        winner !== 'right' &&
        winner !== 'tie' &&
        winner !== 'both_bad' &&
        !(typeof winner === 'number' && Number.isInteger(winner))
      ) {
        sendJson(res, 400, { error: 'Invalid winner' });
        return true;
      }
      const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
      const result = await recordVote(sessionId, winner, notes);
      if ('error' in result) {
        const status = result.error === 'Already voted' ? 409 : 404;
        sendJson(res, status, { error: result.error });
        return true;
      }
      const slotRefs = result.session.slots.map((slot) => ({
        providerId: slot.model.providerId,
        modelId: slot.model.modelId,
        alias: slot.alias,
      }));
      const response = {
        revealed: true,
        slots: slotRefs,
        winner: result.session.winner,
      };
      if (result.session.slots.length === 2 && result.session.left && result.session.right) {
        response.left = result.session.left;
        response.right = result.session.right;
        response.assignment = {
          leftAlias: result.session.leftAlias ?? result.session.slots[0].alias,
          rightAlias: result.session.rightAlias ?? result.session.slots[1].alias,
        };
      }
      sendJson(res, 200, response);
      return true;
    }

    const deleteMatch = pathname.match(/^\/api\/compare\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const sessionId = deleteMatch[1];
      if (!SESSION_ID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return true;
      }
      const ok = await deleteSession(sessionId);
      sendJson(res, 200, { ok });
      return true;
    }

    if (pathname.includes('..')) {
      sendJson(res, 400, { error: 'Invalid path' });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Invalid JSON body' || message === 'Invalid provider id') {
      sendJson(res, 400, { error: message });
      return true;
    }
    console.error('[compare]', message);
    sendJson(res, 500, { error: message });
    return true;
  }
}

/** Connect middleware for Vite dev server. */
export function createCompareMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/compare')) {
      next();
      return;
    }
    const handled = await handleCompareRequest(req, res, url);
    if (!handled) {
      next();
    }
  };
}

/** Reset module state (tests). */
export function resetCompareRoutesForTests() {
  storeLoaded = false;
}
