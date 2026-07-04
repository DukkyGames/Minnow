/**
 * HTTP middleware for /api/settings/* (catalog, read, update).
 */

import { getSettingsCatalog } from './tools.js';
import { readSettings } from './read.js';
import { parseUpdateSettingsArgs, updateSettings } from './update.js';

/** CORS headers aligned with /api/config. */
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
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 */
export async function handleSettingsRequest(req, res, pathname) {
  if (pathname === '/api/settings/catalog' && req.method === 'GET') {
    sendJson(res, 200, { fields: getSettingsCatalog() });
    return true;
  }

  if (pathname === '/api/settings/read' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const result = await readSettings(body);
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: message });
    }
    return true;
  }

  if (pathname === '/api/settings/update' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { changes, confirmed } = parseUpdateSettingsArgs(body);
      const result = await updateSettings(changes, confirmed);
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: message });
    }
    return true;
  }

  if (pathname === '/api/settings/ping' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

export function createSettingsMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/settings')) {
      next();
      return;
    }

    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const handled = await handleSettingsRequest(req, res, url);
    if (!handled) {
      sendJson(res, 404, { error: 'Not found' });
    }
  };
}
