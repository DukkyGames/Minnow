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
  createSession,
  deleteSession,
  getSession,
  getSessionPublic,
  listHistory,
  loadPersistedSessions,
  recordVote,
} from './store.js';

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let storeLoaded = false;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

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

  setCorsHeaders(res);

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
      const pickLeft = parseModelRef(payload.left);
      const pickRight = parseModelRef(payload.right);
      if (!prompt) {
        sendJson(res, 400, { error: 'prompt is required' });
        return true;
      }
      if (!pickLeft || !pickRight) {
        sendJson(res, 400, { error: 'left and right provider/model are required' });
        return true;
      }

      const leftGenerationId = await startCompareGeneration(
        pickLeft.providerId,
        pickLeft.modelId,
        prompt,
        payload.sampler,
      );
      const rightGenerationId = await startCompareGeneration(
        pickRight.providerId,
        pickRight.modelId,
        prompt,
        payload.sampler,
      );

      const session = createSession({
        prompt,
        pickLeft,
        pickRight,
        leftGenerationId,
        rightGenerationId,
      });

      sendJson(res, 201, {
        sessionId: session.id,
        left: { generationId: session.leftGenerationId, label: session.leftAlias },
        right: { generationId: session.rightGenerationId, label: session.rightAlias },
      });
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

    const streamMatch = pathname.match(/^\/api\/compare\/([^/]+)\/stream\/(left|right)$/);
    if (streamMatch && req.method === 'GET') {
      const sessionId = streamMatch[1];
      const side = streamMatch[2];
      if (!SESSION_ID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return true;
      }
      const session = getSession(sessionId);
      if (!session) {
        sendJson(res, 404, { error: 'Session not found' });
        return true;
      }
      const generationId =
        side === 'left' ? session.leftGenerationId : session.rightGenerationId;
      return pipeGenerationStream(req, res, generationId);
    }

    const voteMatch = pathname.match(/^\/api\/compare\/([^/]+)\/vote$/);
    if (voteMatch && req.method === 'POST') {
      const sessionId = voteMatch[1];
      if (!SESSION_ID_RE.test(sessionId)) {
        sendJson(res, 400, { error: 'Invalid session id' });
        return true;
      }
      const payload = await readJsonBody(req);
      const winner = payload.winner;
      if (
        winner !== 'left' &&
        winner !== 'right' &&
        winner !== 'tie' &&
        winner !== 'both_bad'
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
      sendJson(res, 200, {
        revealed: true,
        left: result.session.left,
        right: result.session.right,
        winner: result.session.winner,
        assignment: {
          leftAlias: result.session.leftAlias,
          rightAlias: result.session.rightAlias,
        },
      });
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
