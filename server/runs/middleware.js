/**
 * /api/config/runs/* — leftover registry READS only (P8-G).
 *
 * Existing ~/.minnow/runs/registry/ files are left in place and never imported
 * into the journal (no last-write-wins). Writes return 410.
 */

import {
  buildResultKey,
  listRegistryRecords,
  readCommittedResult,
  readRegistryRecord,
} from './store.js';

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
 * @returns {Promise<boolean>}
 */
export async function handleRunsConfigRequest(req, res, pathname) {

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/config/runs/registry' && req.method === 'GET') {
      const records = await listRegistryRecords();
      sendJson(res, 200, { records });
      return true;
    }

    const registryMatch = pathname.match(/^\/api\/config\/runs\/registry\/([^/]+)$/);
    if (registryMatch) {
      const runId = decodeURIComponent(registryMatch[1]);
      if (req.method === 'GET') {
        const record = await readRegistryRecord(runId);
        if (!record) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, record);
        return true;
      }
      if (req.method === 'PUT') {
        // P8-G: the journal is the record. Leftover ~/.minnow/runs/registry/
        // files are left in place and never imported (no last-write-wins).
        sendJson(res, 410, {
          error: 'sub-agent registry writes are gone; the journal is the record',
        });
        return true;
      }
    }

    const resultMatch = pathname.match(/^\/api\/config\/runs\/results\/([^/]+)$/);
    if (resultMatch) {
      const key = decodeURIComponent(resultMatch[1]);
      if (req.method === 'GET') {
        const data = await readCommittedResult(key);
        if (data == null) {
          sendJson(res, 404, { error: 'Not found' });
          return true;
        }
        sendJson(res, 200, data);
        return true;
      }
      if (req.method === 'PUT') {
        sendJson(res, 410, {
          error: 'sub-agent result writes are gone; the journal is the record',
        });
        return true;
      }
    }

    if (pathname === '/api/config/runs/supersede' && req.method === 'POST') {
      sendJson(res, 410, {
        error: 'sub-agent registry writes are gone; the journal is the record',
      });
      return true;
    }

    if (pathname === '/api/config/runs/result-key' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const boardTaskId = body?.boardTaskId;
      const attempt = Number(body?.attempt);
      if (!boardTaskId || !Number.isFinite(attempt) || attempt < 1) {
        sendJson(res, 400, { error: 'boardTaskId and attempt required' });
        return true;
      }
      sendJson(res, 200, { key: buildResultKey(boardTaskId, attempt) });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[runs]', message);
    sendJson(res, 500, { error: message });
    return true;
  }
}
