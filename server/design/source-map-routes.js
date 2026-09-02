/**
 * Element → source mapping route (MIN-369) — static HTML workspace ladder step. Mirrors
 * annotations-routes.js's shape (single-pathname handler + Connect middleware wrapper) and
 * preview/middleware.js's use of resolveSafePath to stay scoped to the workspace.
 *
 * GET /api/design/source-map?page=<workspace-relative .html path>&tag=&id=&classes=&html=
 *   -> { file, line, confidence: 'exact' | 'probable' } when a match is found
 *   -> { confidence: 'guess' } otherwise (unknown page, non-HTML page, read error, no match)
 *
 * Framework dev-server resolution (React/Vue debug attributes) never reaches this route — it
 * runs client-side via execJs against the live guest (src/design/source-map.ts).
 */

import fs from 'node:fs/promises';
import { findElementLineInSource } from './source-map-match.js';

const SOURCE_MAP_PATH = '/api/design/source-map';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 * @returns {Promise<boolean>}
 */
export async function handleSourceMapRequest(req, res, pathname, deps) {
  if (pathname !== SOURCE_MAP_PATH) return false;

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  const url = new URL(req.url ?? '', 'http://127.0.0.1');
  const page = (url.searchParams.get('page') ?? '').trim();

  if (!page || !/\.html?$/i.test(page.split(/[?#]/)[0])) {
    sendJson(res, 200, { confidence: 'guess' });
    return true;
  }

  const signal = {
    tag: url.searchParams.get('tag') ?? '',
    id: url.searchParams.get('id') ?? '',
    classCombo: url.searchParams.get('classes') ?? '',
    htmlSnippet: url.searchParams.get('html') ?? '',
  };

  try {
    const absPath = await deps.runWithPathAccess(async () => deps.resolveSafePath(page, { write: false }));
    const fileText = await fs.readFile(absPath, 'utf8');
    const match = findElementLineInSource(fileText, signal);
    if (!match) {
      sendJson(res, 200, { file: page, confidence: 'guess' });
      return true;
    }
    sendJson(res, 200, { file: page, line: match.line, confidence: match.confidence });
    return true;
  } catch {
    sendJson(res, 200, { confidence: 'guess' });
    return true;
  }
}

/**
 * @param {{ resolveSafePath: (userPath: string, options?: { write?: boolean }) => string, runWithPathAccess: <T>(fn: () => Promise<T>) => Promise<T> }} deps
 */
export function createSourceMapMiddleware(deps) {
  return async (req, res, next) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname !== SOURCE_MAP_PATH) {
      next();
      return;
    }
    const handled = await handleSourceMapRequest(req, res, pathname, deps);
    if (!handled) next();
  };
}
