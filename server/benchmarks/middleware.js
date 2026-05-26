/**
 * Benchmark run persistence under ~/.minnow/benchmarks/*.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const LIST_CAP = 20;

function benchmarksDir() {
  return path.join(getMinnowHome(), 'benchmarks');
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
      if (size > MAX_BODY_BYTES) {
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

/** Safe filename: ISO timestamp id only. */
function safeRunId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    return null;
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    return null;
  }
  return id;
}

async function listRunSummaries() {
  const dir = benchmarksDir();
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name);

  const runs = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const run = JSON.parse(raw);
      runs.push({
        id: run.id ?? file.replace(/\.json$/, ''),
        startedAt: run.startedAt ?? '',
        modelId: run.model?.id ?? '',
        providerId: run.provider?.id ?? '',
        totalScore: run.totalScore ?? 0,
        headlineTtftMs: run.headlineTtftMs ?? 0,
        headlineTokPerSec: run.headlineTokPerSec ?? 0,
      });
    } catch {
      /* skip corrupt */
    }
  }

  runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return runs.slice(0, LIST_CAP);
}

async function handleGetList(_req, res) {
  await ensureMinnowLayout();
  const runs = await listRunSummaries();
  sendJson(res, 200, { runs });
}

async function handleGetOne(id, res) {
  await ensureMinnowLayout();
  const safe = safeRunId(id);
  if (!safe) {
    sendJson(res, 400, { error: 'Invalid run id' });
    return;
  }
  const filePath = path.join(benchmarksDir(), `${safe}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const run = JSON.parse(raw);
    sendJson(res, 200, run);
  } catch {
    sendJson(res, 404, { error: 'Run not found' });
  }
}

async function handlePost(body, res) {
  await ensureMinnowLayout();
  const id =
    typeof body?.id === 'string' && body.id.trim()
      ? body.id.trim()
      : new Date().toISOString().replace(/[:.]/g, '-');
  const safe = safeRunId(id);
  if (!safe) {
    sendJson(res, 400, { error: 'Invalid run id' });
    return;
  }
  const filePath = path.join(benchmarksDir(), `${safe}.json`);
  const payload = { ...body, id: safe };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  sendJson(res, 201, { ok: true, id: safe });
}

export function createBenchmarksMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/benchmarks')) {
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
      if (url === '/api/benchmarks' && req.method === 'GET') {
        await handleGetList(req, res);
        return;
      }

      const match = url.match(/^\/api\/benchmarks\/([^/]+)$/);
      if (match && req.method === 'GET') {
        await handleGetOne(decodeURIComponent(match[1]), res);
        return;
      }

      if (url === '/api/benchmarks' && req.method === 'POST') {
        const body = await readJsonBody(req);
        await handlePost(body, res);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  };
}
