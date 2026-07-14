/**
 * Draw & Comment tool persistence (MIN-367): shapes + comment pins keyed by page identity,
 * scoped to the active workspace. Mirrors config/middleware.js's JSON-blob-per-resource
 * pattern, but writes under the *workspace* (not ~/.minnow) via resolveSafePath, same as
 * preview/middleware.js — so annotations travel with the project, not the user's machine.
 *
 * GET  /api/design/annotations?page=<pageKey>  -> { shapes: [], pins: [] }
 * PUT  /api/design/annotations                 -> body { page, annotations }
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ANNOTATIONS_RELATIVE_PATH = path.join('.minnow', 'design', 'annotations.json');
const EMPTY_PAGE = { shapes: [], pins: [] };

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
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
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 * @returns {Promise<{ version: number, pages: Record<string, { shapes: unknown[], pins: unknown[] }> }>}
 */
async function readAllAnnotations(deps) {
  const absPath = await deps.runWithPathAccess(async () =>
    deps.resolveSafePath(ANNOTATIONS_RELATIVE_PATH, { write: false }),
  );
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.pages && typeof parsed.pages === 'object') {
      return parsed;
    }
    return { version: 1, pages: {} };
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { version: 1, pages: {} };
    }
    throw err;
  }
}

/**
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 * @param {{ version: number, pages: Record<string, unknown> }} data
 */
async function writeAllAnnotations(deps, data) {
  const absPath = await deps.runWithPathAccess(async () =>
    deps.resolveSafePath(ANNOTATIONS_RELATIVE_PATH, { write: true }),
  );
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, absPath);
}

function normalizePageAnnotations(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PAGE };
  return {
    shapes: Array.isArray(raw.shapes) ? raw.shapes : [],
    pins: Array.isArray(raw.pins) ? raw.pins : [],
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 * @returns {Promise<boolean>}
 */
export async function handleDesignAnnotationsRequest(req, res, pathname, deps) {
  if (pathname !== '/api/design/annotations') return false;

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url ?? '', 'http://127.0.0.1');
      const page = url.searchParams.get('page') ?? '';
      if (!page) {
        sendJson(res, 400, { error: 'page is required' });
        return true;
      }
      const all = await readAllAnnotations(deps);
      sendJson(res, 200, normalizePageAnnotations(all.pages[page]));
      return true;
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const page = typeof body?.page === 'string' ? body.page.trim() : '';
      if (!page) {
        sendJson(res, 400, { error: 'page is required' });
        return true;
      }
      const annotations = normalizePageAnnotations(body?.annotations);
      const all = await readAllAnnotations(deps);
      all.pages[page] = annotations;
      await writeAllAnnotations(deps, all);
      sendJson(res, 200, { ok: true, data: annotations });
      return true;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
    return true;
  }
}

/**
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 */
export function createDesignAnnotationsMiddleware(deps) {
  return async (req, res, next) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname !== '/api/design/annotations') {
      next();
      return;
    }
    const handled = await handleDesignAnnotationsRequest(req, res, pathname, deps);
    if (!handled) next();
  };
}
