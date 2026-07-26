/**
 * HTTP middleware for /api/session/* (Phase 0 state sync + Phase 1+ commands).
 * Phase 4 (MIN-362): driver lease endpoints removed — engine is sole driver.
 */

import { readResource } from '../config/store.js';
import {
  getSessionRev,
  getCachedSessionState,
  seedSessionRevState,
} from './rev-store.js';
import { addSessionStreamSubscriber } from './sse.js';
import {
  isSessionRequestAuthorized,
  sendSessionUnauthorized,
} from './auth.js';
import { isServerEngineEnabled } from './flag.js';
import { applyCommand, ensureSessionEngineBooted } from './engine.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, If-Match',
  );
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

function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

/**
 * Load session state + rev for SSE snapshot (boot-time seed when needed).
 * @returns {Promise<{ rev: number, state: unknown }>}
 */
async function loadSessionSnapshot() {
  let state = getCachedSessionState();
  let rev = getSessionRev();
  if (state == null || rev === 0) {
    state = await readResource('sessions');
    seedSessionRevState(state);
    rev = getSessionRev();
  }
  return { rev, state };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleSessionRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/session')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Flag probe is unauthenticated so the SPA can decide before sync bootstraps.
  if (pathname === '/api/session/engine' && req.method === 'GET') {
    sendJson(res, 200, { enabled: isServerEngineEnabled() });
    return true;
  }

  if (!isSessionRequestAuthorized(req)) {
    sendSessionUnauthorized(res);
    return true;
  }

  try {
    if (pathname === '/api/session/stream' && req.method === 'GET') {
      const snapshot = await loadSessionSnapshot();
      addSessionStreamSubscriber(req, res, snapshot);
      return true;
    }

    if (pathname === '/api/session/commands' && req.method === 'POST') {
      if (!isServerEngineEnabled()) {
        sendJson(res, 503, {
          error: 'Server session engine is disabled',
          code: 'ENGINE_DISABLED',
        });
        return true;
      }
      await ensureSessionEngineBooted();
      const body = await readJsonBody(req);
      const result = await applyCommand(body);
      sendJson(res, 202, {
        rev: result.rev,
        accepted: result.accepted,
        detail: result.detail,
      });
      return true;
    }

    // Phase 4: /api/session/lease removed — engine is sole driver by construction.
    if (pathname === '/api/session/lease') {
      sendJson(res, 410, {
        error: 'Board driver lease removed; Session Engine is the sole driver',
        code: 'LEASE_REMOVED',
      });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode =
      err &&
      typeof err === 'object' &&
      typeof /** @type {{ statusCode?: number }} */ (err).statusCode === 'number'
        ? /** @type {{ statusCode: number }} */ (err).statusCode
        : 500;
    if (statusCode >= 500) {
      console.error('[session]', message);
    }
    sendJson(res, statusCode, { error: message });
    return true;
  }
}

/** Connect middleware for Vite dev server. */
export function createSessionMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/session')) {
      next();
      return;
    }

    const handled = await handleSessionRequest(req, res, url);
    if (!handled) {
      next();
    }
  };
}
