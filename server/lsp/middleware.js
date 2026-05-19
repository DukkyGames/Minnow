/**
 * /api/lsp/* and /api/config/lsp middleware.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getSpeedChatHome } from '../config/home.js';
import {
  loadMergedLspConfig,
  invalidateLspConfigCache,
  seedLspJson,
} from './config-loader.js';
import { getLspDiagnostics, listLspServers } from './manager.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createLspMiddleware(projectRoot) {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/lsp') && url !== '/api/config/lsp') {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url === '/api/lsp/status' && req.method === 'GET') {
        const merged = await loadMergedLspConfig();
        const servers = await listLspServers();
        sendJson(res, 200, { enabled: merged.enabled !== false, servers });
        return;
      }

      if (url === '/api/lsp/diagnostics' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const rel = String(body.path ?? '');
        if (!rel || rel.includes('..')) {
          sendJson(res, 400, { error: 'Invalid path' });
          return;
        }
        const abs = path.resolve(projectRoot, rel);
        const rootNorm = path.resolve(projectRoot);
        if (!abs.startsWith(rootNorm)) {
          sendJson(res, 400, { error: 'Path outside project' });
          return;
        }
        const result = await getLspDiagnostics(rel);
        sendJson(res, 200, { result });
        return;
      }

      if (url === '/api/lsp/notify' && req.method === 'POST') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url === '/api/config/lsp' && req.method === 'GET') {
        const merged = await loadMergedLspConfig();
        const servers = await listLspServers();
        sendJson(res, 200, {
          enabled: merged.enabled !== false,
          lsp: merged.lsp,
          servers,
        });
        return;
      }

      if (url === '/api/config/lsp' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const home = getSpeedChatHome();
        const filePath = path.join(home, 'lsp.json');
        let current = {};
        try {
          current = JSON.parse(await fs.readFile(filePath, 'utf8'));
        } catch {
          current = await seedLspJson(
            JSON.parse(
              await fs.readFile(
                path.join(projectRoot, 'src/lsp/defaults.json'),
                'utf8',
              ),
            ),
          );
        }
        const nextCfg = {
          ...current,
          ...body,
          lsp: { ...(current.lsp ?? {}), ...(body.lsp ?? {}) },
        };
        await fs.writeFile(filePath, `${JSON.stringify(nextCfg, null, 2)}\n`, 'utf8');
        invalidateLspConfigCache();
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  };
}

export async function initLspConfig() {
  const merged = await loadMergedLspConfig();
  return merged;
}
