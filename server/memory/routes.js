/**
 * HTTP handlers for /api/memory/* (Vite configureServer middleware).
 */

import {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  clearEntries,
  loadMemoryConfig,
  saveMemoryConfig,
  getEntryCount,
  loadAllEntriesWithBodies,
  ensureMemoryStore,
} from './store.js';
import { retrieveMemoryBlock } from './retrieve.js';
import { backupMemory, restoreMemory } from './backup.js';
import { isValidEntryId } from './paths.js';
import { getSpeedChatHome } from '../config/home.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
 * Handle /api/memory requests. Returns true if handled.
 */
export async function handleMemoryRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/memory')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/memory/ping' && req.method === 'GET') {
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/memory/status' && req.method === 'GET') {
      const memory = await loadMemoryConfig();
      const entryCount = await getEntryCount();
      sendJson(res, 200, {
        enabled: memory.enabled !== false,
        entryCount,
        home: getSpeedChatHome(),
      });
      return true;
    }

    if (pathname === '/api/memory/entries' && req.method === 'GET') {
      const entries = await listEntries();
      sendJson(res, 200, { entries });
      return true;
    }

    const entryMatch = pathname.match(/^\/api\/memory\/entries\/([^/]+)$/);
    if (entryMatch) {
      const id = decodeURIComponent(entryMatch[1]);
      if (!isValidEntryId(id)) {
        sendJson(res, 400, { error: 'Invalid entry id' });
        return true;
      }

      if (req.method === 'GET') {
        const row = await getEntry(id);
        if (!row) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, row);
        return true;
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const entry = await updateEntry(id, body);
        if (!entry) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, { entry });
        return true;
      }

      if (req.method === 'DELETE') {
        const ok = await deleteEntry(id);
        if (!ok) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    if (pathname === '/api/memory/entries' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const entry = await createEntry(body);
      sendJson(res, 201, { entry });
      return true;
    }

    if (pathname === '/api/memory/retrieve' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const memory = await loadMemoryConfig();
      if (memory.enabled === false) {
        sendJson(res, 200, { block: '', ids: [] });
        return true;
      }
      const profile = body.profile === 'lite' ? 'lite' : 'full';
      const maxChars =
        profile === 'lite'
          ? memory.maxInjectCharsLite ?? 800
          : memory.maxInjectCharsFull ?? 4000;
      const all = await loadAllEntriesWithBodies();
      const { block, ids } = retrieveMemoryBlock(all, {
        query: body.query,
        limit: body.limit ?? 8,
        tags: body.tags,
        maxChars,
      });
      sendJson(res, 200, { block, ids });
      return true;
    }

    if (pathname === '/api/memory/clear' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await clearEntries(body.archive === true);
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/memory/backup' && req.method === 'POST') {
      const result = await backupMemory();
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/memory/restore' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.backupId) {
        sendJson(res, 400, { error: 'backupId required' });
        return true;
      }
      const result = await restoreMemory(String(body.backupId));
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err.statusCode ?? 500;
    sendJson(res, status, { error: message });
    return true;
  }
}

/** Startup hook: ensure memory store layout exists. */
export async function initMemoryApi() {
  await ensureMemoryStore();
}
