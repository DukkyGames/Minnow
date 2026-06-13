/**
 * HTTP handlers for /api/benchmark-workspace (Vite configureServer middleware).
 */

import { getBenchmarkWorkspacePath } from './paths.js';

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
 * Handle /api/benchmark-workspace requests. Returns true when handled.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 */
export async function handleBenchmarkWorkspaceRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/benchmark-workspace')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (pathname === '/api/benchmark-workspace' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, path: getBenchmarkWorkspacePath() });
    return true;
  }

  if (pathname.startsWith('/api/benchmark-workspace')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}
