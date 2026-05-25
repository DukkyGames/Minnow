/**
 * Eval harness API: packs, config, suite run artifacts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';
import { deleteUserEvalPack, saveUserEvalPack } from './pack-store.js';
import {
  getEvalPackById,
  listMergedEvalPacks,
} from './scan.js';
import {
  getCell,
  getRunDetail,
  listRunSummaries,
  saveCell,
  saveLeaderboard,
  saveManifest,
} from './run-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const DEFAULT_EVAL_CONFIG = {
  version: 1,
  maxConcurrency: 2,
  graderProviderId: '',
  graderModelId: '',
  graderTimeoutMs: 30_000,
  saveFullTranscripts: false,
  skipApprovalDuringEval: false,
};

function evalConfigPath() {
  return path.join(getMinnowHome(), 'evals', 'config.json');
}

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
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
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

async function readEvalConfig() {
  try {
    const raw = await fs.readFile(evalConfigPath(), 'utf8');
    return { ...DEFAULT_EVAL_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_EVAL_CONFIG };
  }
}

async function writeEvalConfig(config) {
  await fs.mkdir(path.dirname(evalConfigPath()), { recursive: true });
  await fs.writeFile(
    evalConfigPath(),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
}

export function createEvalsMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/evals')) {
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
      await ensureMinnowLayout();

      if (url === '/api/evals/ping' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url === '/api/evals/config') {
        if (req.method === 'GET') {
          sendJson(res, 200, await readEvalConfig());
          return;
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const merged = { ...(await readEvalConfig()), ...body };
          if (typeof merged.maxConcurrency === 'number') {
            merged.maxConcurrency = Math.max(1, Math.min(8, Math.floor(merged.maxConcurrency)));
          }
          await writeEvalConfig(merged);
          sendJson(res, 200, merged);
          return;
        }
      }

      if (url === '/api/evals/packs' && req.method === 'GET') {
        const packs = await listMergedEvalPacks(PROJECT_ROOT);
        sendJson(res, 200, { packs });
        return;
      }

      const packMatch = url.match(/^\/api\/evals\/packs\/([^/]+)$/);
      if (packMatch) {
        const packId = decodeURIComponent(packMatch[1]);
        if (req.method === 'GET') {
          const pack = await getEvalPackById(PROJECT_ROOT, packId);
          if (!pack) {
            sendJson(res, 404, { error: 'Pack not found' });
            return;
          }
          sendJson(res, 200, { pack });
          return;
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const pack = body?.pack ?? body;
          pack.source = 'user';
          await saveUserEvalPack(pack);
          const saved = await getEvalPackById(PROJECT_ROOT, packId);
          sendJson(res, 200, { ok: true, pack: saved });
          return;
        }
        if (req.method === 'DELETE') {
          await deleteUserEvalPack(packId);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      if (url === '/api/evals/runs' && req.method === 'GET') {
        const runs = await listRunSummaries();
        sendJson(res, 200, { runs });
        return;
      }

      const runMatch = url.match(/^\/api\/evals\/runs\/([^/]+)$/);
      if (runMatch && req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (body?.manifest) {
          await saveManifest(body.manifest);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (runMatch && req.method === 'GET') {
        const detail = await getRunDetail(decodeURIComponent(runMatch[1]));
        if (!detail) {
          sendJson(res, 404, { error: 'Run not found' });
          return;
        }
        sendJson(res, 200, detail);
        return;
      }

      const leaderboardMatch = url.match(/^\/api\/evals\/runs\/([^/]+)\/leaderboard$/);
      if (leaderboardMatch && req.method === 'PUT') {
        const body = await readJsonBody(req);
        await saveLeaderboard(
          decodeURIComponent(leaderboardMatch[1]),
          body?.leaderboard ?? [],
        );
        sendJson(res, 200, { ok: true });
        return;
      }

      const cellMatch = url.match(/^\/api\/evals\/runs\/([^/]+)\/cells\/([^/]+)$/);
      if (cellMatch) {
        const suiteRunId = decodeURIComponent(cellMatch[1]);
        const cellId = decodeURIComponent(cellMatch[2]);
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          if (body?.cell) await saveCell(suiteRunId, body.cell);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (req.method === 'GET') {
          const cell = await getCell(suiteRunId, cellId);
          if (!cell) {
            sendJson(res, 404, { error: 'Cell not found' });
            return;
          }
          sendJson(res, 200, { cell });
          return;
        }
      }

      const cancelMatch = url.match(/^\/api\/evals\/runs\/([^/]+)\/cancel$/);
      if (cancelMatch && req.method === 'POST') {
        sendJson(res, 200, { ok: true, cancelled: true });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  };
}
