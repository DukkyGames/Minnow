/**
 * Workspace file preview routes for the in-app browser panel.
 * GET /api/preview/ping — health
 * GET /api/preview/file/* — stream a workspace file with safe path resolution
 */

import fsp from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { contentTypeForPreviewPath } from './mime-types.js';

const PREVIEW_FILE_PREFIX = '/api/preview/file/';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Decode the path segment after /api/preview/file/ (may contain slashes).
 * @param {string} pathname
 * @returns {string | null}
 */
function decodePreviewRelativePath(pathname) {
  if (!pathname.startsWith(PREVIEW_FILE_PREFIX)) return null;
  const encoded = pathname.slice(PREVIEW_FILE_PREFIX.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {{ resolveSafePath: (userPath: string) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 * @returns {Promise<boolean>}
 */
export async function handlePreviewRequest(req, res, pathname, deps) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    if (pathname.startsWith('/api/preview')) {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    return false;
  }

  if (pathname === '/api/preview/ping') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  const relativePath = decodePreviewRelativePath(pathname);
  if (relativePath === null) {
    if (pathname.startsWith('/api/preview')) {
      sendJson(res, 404, { error: 'Not found' });
      return true;
    }
    return false;
  }

  try {
    const absPath = await deps.runWithPathAccess(async () => deps.resolveSafePath(relativePath));
    const stat = await fsp.stat(absPath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'Not a file' });
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeForPreviewPath(absPath));
    res.setHeader('Cache-Control', 'no-store');
    const stream = createReadStream(absPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Failed to read file' });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
    return true;
  }
}

/**
 * @param {{ resolveSafePath: (userPath: string) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 */
export function createPreviewMiddleware(deps) {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/preview')) {
      next();
      return;
    }
    const handled = await handlePreviewRequest(req, res, parsed.pathname, deps);
    if (!handled) next();
  };
}
