/**
 * HTTP middleware for /api/session/* (Phase 0 state sync + driver lease).
 */

import { readResource } from '../config/store.js';
import {
  getSessionRev,
  getCachedSessionState,
  seedSessionRevState,
} from './rev-store.js';
import { addSessionStreamSubscriber } from './sse.js';
import {
  claimBoardDriverLease,
  renewBoardDriverLease,
  releaseBoardDriverLease,
  getBoardDriverLease,
} from './lease.js';
import {
  isSessionRequestAuthorized,
  sendSessionUnauthorized,
} from './auth.js';

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

    if (pathname === '/api/session/lease' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const driverId = typeof body.driverId === 'string' ? body.driverId : '';
      const action = typeof body.action === 'string' ? body.action : 'claim';
      const label = typeof body.label === 'string' ? body.label : '';

      if (!driverId.trim()) {
        sendJson(res, 400, { error: 'driverId is required' });
        return true;
      }

      if (action === 'renew') {
        const result = renewBoardDriverLease(driverId);
        sendJson(res, 200, { ...result, lease: getBoardDriverLease() });
        return true;
      }

      if (action === 'release') {
        releaseBoardDriverLease(driverId);
        sendJson(res, 200, { ok: true, lease: getBoardDriverLease() });
        return true;
      }

      const result = claimBoardDriverLease(driverId, label);
      sendJson(res, 200, { ...result, lease: getBoardDriverLease() });
      return true;
    }

    if (pathname === '/api/session/lease' && req.method === 'GET') {
      sendJson(res, 200, { lease: getBoardDriverLease() });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[session]', message);
    sendJson(res, 500, { error: message });
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
