/**
 * System probes — VRAM and related machine metrics.
 */

import { probeVram } from './vram.js';
import { listDeadHosts } from '../generations/host-cooldown.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleSystemRequest(req, res, pathname) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (pathname === '/api/system/vram' && req.method === 'GET') {
    const payload = await probeVram();
    sendJson(res, 200, payload);
    return true;
  }

  if (pathname === '/api/system/host-health' && req.method === 'GET') {
    sendJson(res, 200, { hosts: listDeadHosts() });
    return true;
  }

  if (pathname.startsWith('/api/system')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

/** Vite connect middleware factory. */
export function createSystemMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/system')) {
      next();
      return;
    }
    const handled = await handleSystemRequest(req, res, parsed.pathname);
    if (!handled) {
      next();
    }
  };
}
