/**
 * /api/workspace — get, set, and pick the AI workspace folder.
 */

import {
  buildRecentWorkspaceList,
  getWorkspaceInfo,
  removeRecentWorkspacePath,
  setWorkspaceRoot,
  validateWorkspacePath,
} from './root.js';
import { pickWorkspaceFolder } from './pick-folder.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
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
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleWorkspaceRequest(req, res, pathname) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/workspace' && req.method === 'GET') {
      const recent = await buildRecentWorkspaceList();
      sendJson(res, 200, { ok: true, ...getWorkspaceInfo(), recent });
      return true;
    }

    if (pathname === '/api/workspace/recent' && req.method === 'DELETE') {
      const body = await readJsonBody(req);
      const userPath = body?.path;
      if (typeof userPath !== 'string' || !userPath.trim()) {
        sendJson(res, 400, { error: 'path is required' });
        return true;
      }
      await removeRecentWorkspacePath(userPath);
      const recent = await buildRecentWorkspaceList();
      sendJson(res, 200, { ok: true, recent });
      return true;
    }

    if (pathname === '/api/workspace' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const userPath = body?.path;
      if (typeof userPath !== 'string' || !userPath.trim()) {
        sendJson(res, 400, { error: 'path is required' });
        return true;
      }
      const resolved = await setWorkspaceRoot(userPath);
      sendJson(res, 200, {
        ok: true,
        path: resolved,
        label: getWorkspaceInfo().label,
        isDefault: getWorkspaceInfo().isDefault,
      });
      return true;
    }

    if (pathname === '/api/workspace/pick' && req.method === 'POST') {
      const pick = await pickWorkspaceFolder();
      if (pick.error) {
        sendJson(res, 500, { error: pick.error, cancelled: false });
        return true;
      }
      if (pick.cancelled || !pick.path) {
        sendJson(res, 200, { ok: true, cancelled: true, path: null });
        return true;
      }
      const resolved = await validateWorkspacePath(pick.path);
      await setWorkspaceRoot(resolved);
      sendJson(res, 200, {
        ok: true,
        cancelled: false,
        path: resolved,
        label: getWorkspaceInfo().label,
        isDefault: getWorkspaceInfo().isDefault,
      });
      return true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
    return true;
  }

  if (pathname.startsWith('/api/workspace')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

/** Vite connect middleware factory. */
export function createWorkspaceMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/workspace')) {
      next();
      return;
    }
    const handled = await handleWorkspaceRequest(req, res, url);
    if (!handled) {
      next();
    }
  };
}
