/**
 * HTTP middleware for /api/generations (backend-owned LLM streams).
 */

import { getProviderRuntime } from '../providers/store.js';
import { validateProviderId } from '../providers/validate.js';
import { pumpUpstream } from './upstream.js';
import {
  addSubscriber,
  cancel,
  createGenerationState,
  getGenerationState,
  removeSubscriber,
} from './store.js';

const GENERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isGenerationId(segment) {
  return typeof segment === 'string' && GENERATION_ID_RE.test(segment);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleGenerationsRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/generations')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/generations' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      const providerId =
        typeof payload.providerId === 'string' ? validateProviderId(payload.providerId) : null;
      if (!providerId) {
        sendJson(res, 400, { error: 'providerId is required' });
        return true;
      }
      if (payload.body === undefined || payload.body === null) {
        sendJson(res, 400, { error: 'body is required' });
        return true;
      }

      const runtime = await getProviderRuntime(providerId);
      const url = `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`;
      const state = createGenerationState({
        providerId,
        body: payload.body,
        persist: payload.persist === true,
      });

      pumpUpstream({ state, url, headers: runtime.headers });
      sendJson(res, 201, { generationId: state.id });
      return true;
    }

    const streamMatch = pathname.match(/^\/api\/generations\/([^/]+)\/stream$/);
    if (streamMatch && req.method === 'GET') {
      const id = streamMatch[1];
      if (!isGenerationId(id)) {
        sendJson(res, 400, { error: 'Invalid generation id' });
        return true;
      }
      const state = getGenerationState(id);
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

      // Client disconnect must not cancel upstream — tear down this SSE socket only.
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

    const cancelMatch = pathname.match(/^\/api\/generations\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      const id = cancelMatch[1];
      if (!isGenerationId(id)) {
        sendJson(res, 400, { error: 'Invalid generation id' });
        return true;
      }
      const state = getGenerationState(id);
      if (!state) {
        sendJson(res, 404, { error: 'Generation not found' });
        return true;
      }
      cancel(state);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const statusMatch = pathname.match(/^\/api\/generations\/([^/]+)$/);
    if (statusMatch && req.method === 'GET') {
      const id = statusMatch[1];
      if (!isGenerationId(id)) {
        sendJson(res, 400, { error: 'Invalid generation id' });
        return true;
      }
      const state = getGenerationState(id);
      if (!state) {
        sendJson(res, 404, { error: 'Generation not found' });
        return true;
      }
      sendJson(res, 200, {
        status: state.status,
        totalBytes: state.totalBytes,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        errorMessage: state.errorMessage,
      });
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
    if (message === 'Invalid provider id' || message === 'Invalid JSON body') {
      sendJson(res, 400, { error: message });
      return true;
    }
    if (message.includes('ENOENT') || message.includes('not found')) {
      sendJson(res, 404, { error: 'Provider not found' });
      return true;
    }
    console.error('[generations]', message);
    sendJson(res, 500, { error: message });
    return true;
  }
}

/** Connect middleware for Vite dev server. */
export function createGenerationsMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/generations')) {
      next();
      return;
    }

    const handled = await handleGenerationsRequest(req, res, url);
    if (!handled) {
      next();
    }
  };
}

