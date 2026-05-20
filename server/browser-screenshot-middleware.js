/**
 * Serve PNG screenshots from ~/.minnow/screenshots/ (Step 12).
 */

import fs from 'node:fs/promises';
import { resolveScreenshotPath } from './cdp/paths.js';

/** CORS headers for dev SPA. */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Vite middleware: GET /api/browser/screenshot/:id
 */
export function createBrowserScreenshotMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    const prefix = '/api/browser/screenshot/';
    if (!url.startsWith(prefix)) {
      next();
      return;
    }

    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const id = decodeURIComponent(url.slice(prefix.length)).replace(/\.png$/i, '');
    const filePath = await resolveScreenshotPath(id);
    if (!filePath) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      const data = await fs.readFile(filePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  };
}
