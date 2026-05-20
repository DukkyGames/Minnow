/**
 * /api/lsp/* and /api/config/lsp middleware.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import {
  loadMergedLspConfig,
  invalidateLspConfigCache,
  seedLspJson,
} from './config-loader.js';
import {
  getLspCompletions,
  getLspDiagnostics,
  listLspServers,
  notifyLspDocument,
} from './manager.js';

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

export function createLspMiddleware(resolveProjectRoot) {
  const getRoot =
    typeof resolveProjectRoot === 'function'
      ? resolveProjectRoot
      : () => resolveProjectRoot;

  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/lsp') && url !== '/api/config/lsp') {
      next();
      return;
    }

    const projectRoot = getRoot();

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
        const event = String(body.event ?? '');
        if (!['open', 'change', 'close'].includes(event)) {
          sendJson(res, 400, { error: 'Invalid event' });
          return;
        }
        const result = await notifyLspDocument(
          rel,
          event,
          typeof body.text === 'string' ? body.text : undefined,
        );
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (url === '/api/lsp/completion' && req.method === 'POST') {
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
        const line = Number(body.line);
        const character = Number(body.character);
        if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) {
          sendJson(res, 400, { error: 'Invalid position' });
          return;
        }
        const { items, error } = await getLspCompletions(rel, line, character);
        sendJson(res, 200, { items, ...(error ? { error } : {}) });
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
        const home = getMinnowHome();
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
        if (Array.isArray(body.removeLspIds)) {
          for (const id of body.removeLspIds) {
            if (typeof id === 'string' && id) {
              delete nextCfg.lsp[id];
            }
          }
        }
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
