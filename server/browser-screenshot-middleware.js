/**
 * Serve and accept PNG screenshots from ~/.minnow/screenshots/ (Step 12).
 */

import fs from 'node:fs/promises';
import { resolveScreenshotPath, writeScreenshot } from './cdp/paths.js';

/** CORS headers for dev SPA. */
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

/**
 * Vite middleware: GET/POST /api/browser/screenshot[/:id]
 */
export function createBrowserScreenshotMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    const prefix = '/api/browser/screenshot';
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

    if (url === prefix && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const dataBase64 =
          typeof body.dataBase64 === 'string' ? body.dataBase64.trim() : '';
        if (!dataBase64) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'dataBase64 is required' }));
          return;
        }
        const pngBuffer = Buffer.from(dataBase64, 'base64');
        const { id, sizeBytes } = await writeScreenshot(pngBuffer);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id, sizeBytes }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    const getPrefix = `${prefix}/`;
    if (!url.startsWith(getPrefix)) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const id = decodeURIComponent(url.slice(getPrefix.length)).replace(/\.png$/i, '');
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
