/**
 * Browser navigation allowlist API (check + user-approved grants).
 */

import {
  consumeEphemeralNavigation,
  grantEphemeralNavigation,
  isNavigationAllowed,
  originFromUrl,
  suggestAllowlistPattern,
} from './cdp/allowlist.js';
import {
  appendBrowserAllowlistPattern,
  loadBrowserConfig,
  resetBrowserConfigCache,
} from './cdp/browser-config.js';

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
 * Vite middleware: /api/browser/allowlist/*
 */
export function createBrowserAllowlistMiddleware() {
  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/browser/allowlist')) {
      next();
      return;
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (pathname === '/api/browser/allowlist/check' && req.method === 'GET') {
        const url = new URL(req.url ?? '', 'http://localhost');
        const target = url.searchParams.get('url') ?? '';
        if (!target.trim()) {
          sendJson(res, 400, { error: 'url query parameter is required' });
          return;
        }

        const cfg = await loadBrowserConfig();
        const allowed = isNavigationAllowed(target, cfg.allowedOriginPatterns);
        sendJson(res, 200, {
          allowed,
          allowNavigate: cfg.allowNavigate,
          suggestedPattern: suggestAllowlistPattern(target),
          origin: originFromUrl(target),
        });
        return;
      }

      if (pathname === '/api/browser/allowlist/consume' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const targetUrl = typeof body.url === 'string' ? body.url.trim() : '';
        if (!targetUrl) {
          sendJson(res, 400, { error: 'url is required' });
          return;
        }
        let origin;
        try {
          origin = originFromUrl(targetUrl);
        } catch {
          sendJson(res, 400, { error: 'invalid url' });
          return;
        }
        const consumed = consumeEphemeralNavigation(origin);
        sendJson(res, 200, { ok: true, consumed, origin });
        return;
      }

      if (pathname === '/api/browser/allowlist/approve' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const targetUrl = typeof body.url === 'string' ? body.url.trim() : '';
        const mode = body.mode === 'persist' ? 'persist' : 'once';

        if (!targetUrl) {
          sendJson(res, 400, { error: 'url is required' });
          return;
        }

        let origin;
        try {
          origin = originFromUrl(targetUrl);
        } catch {
          sendJson(res, 400, { error: 'invalid url' });
          return;
        }

        if (mode === 'once') {
          grantEphemeralNavigation(origin);
          sendJson(res, 200, { ok: true, mode: 'once', origin });
          return;
        }

        const pattern = suggestAllowlistPattern(targetUrl);
        const added = await appendBrowserAllowlistPattern(pattern);
        resetBrowserConfigCache();
        sendJson(res, 200, { ok: true, mode: 'persist', pattern, added });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  };
}
