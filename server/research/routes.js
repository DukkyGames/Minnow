/**
 * HTTP middleware for /api/research (Deep Research task API + SSE progress).
 */

import { generateVisualReport } from './visual-report.js';
import {
  addSubscriber,
  cancelResearch,
  deleteResearch,
  getResearchDetail,
  getResearchResult,
  getResearchStatus,
  getResearchTask,
  isResearchId,
  listResearchLibrary,
  removeSubscriber,
  setResearchArchived,
  startResearch,
} from './store.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {URL}
 */
function requestUrl(req) {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleResearchRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/research')) {
    return false;
  }

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/research/start' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      const started = await startResearch(payload);
      sendJson(res, 201, started);
      return true;
    }

    if (pathname === '/api/research/library' && req.method === 'GET') {
      const url = requestUrl(req);
      const list = await listResearchLibrary({
        search: url.searchParams.get('search') ?? undefined,
        sort: url.searchParams.get('sort') ?? undefined,
        limit: url.searchParams.has('limit')
          ? Number(url.searchParams.get('limit'))
          : undefined,
        archived: url.searchParams.get('archived') === 'true',
      });
      sendJson(res, 200, list);
      return true;
    }

    const streamMatch = pathname.match(/^\/api\/research\/stream\/([^/]+)$/);
    if (streamMatch && req.method === 'GET') {
      const id = streamMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      let state = getResearchTask(id);
      if (!state) {
        const status = await getResearchStatus(id);
        if (!status) {
          sendJson(res, 404, { error: 'Research not found' });
          return true;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.end(
          `data: ${JSON.stringify({ status: status.status, final: true })}\n\n`,
        );
        return true;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      addSubscriber(state, res);

      const onClientDisconnect = () => {
        removeSubscriber(state, res);
        if (!res.writableEnded && !res.destroyed) {
          res.destroy();
        }
      };
      req.on('close', onClientDisconnect);
      req.on('aborted', onClientDisconnect);
      res.on('close', onClientDisconnect);
      return true;
    }

    const statusMatch = pathname.match(/^\/api\/research\/status\/([^/]+)$/);
    if (statusMatch && req.method === 'GET') {
      const id = statusMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const status = await getResearchStatus(id);
      if (!status) {
        sendJson(res, 404, { error: 'Research not found' });
        return true;
      }
      sendJson(res, 200, status);
      return true;
    }

    const cancelMatch = pathname.match(/^\/api\/research\/cancel\/([^/]+)$/);
    if (cancelMatch && req.method === 'POST') {
      const id = cancelMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const cancelled = cancelResearch(id);
      if (!cancelled && !(await getResearchStatus(id))) {
        sendJson(res, 404, { error: 'Research not found' });
        return true;
      }
      sendJson(res, 200, { cancelled });
      return true;
    }

    const resultMatch = pathname.match(/^\/api\/research\/result\/([^/]+)$/);
    if (resultMatch && req.method === 'GET') {
      const id = resultMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const result = await getResearchResult(id);
      if (!result) {
        sendJson(res, 404, { error: 'Research result not found' });
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    const reportMatch = pathname.match(/^\/api\/research\/report\/([^/]+)$/);
    if (reportMatch && req.method === 'GET') {
      const id = reportMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const detail = await getResearchDetail(id);
      if (!detail) {
        sendJson(res, 404, { error: 'Research not found' });
        return true;
      }
      const query = typeof detail.query === 'string' ? detail.query : '';
      const reportMd =
        (typeof detail.raw_report === 'string' && detail.raw_report) ||
        (typeof detail.result === 'string' ? detail.result : '');
      if (!reportMd) {
        sendJson(res, 404, { error: 'No report content available' });
        return true;
      }
      const html = generateVisualReport(
        query,
        reportMd,
        Array.isArray(detail.sources) ? detail.sources : [],
        detail.stats && typeof detail.stats === 'object'
          ? /** @type {Record<string, string | number>} */ (detail.stats)
          : {},
        typeof detail.category === 'string' ? detail.category : null,
        id,
      );
      sendHtml(res, 200, html);
      return true;
    }

    const detailMatch = pathname.match(/^\/api\/research\/detail\/([^/]+)$/);
    if (detailMatch && req.method === 'GET') {
      const id = detailMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const detail = await getResearchDetail(id);
      if (!detail) {
        sendJson(res, 404, { error: 'Research not found' });
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }

    const archiveMatch = pathname.match(/^\/api\/research\/([^/]+)\/archive$/);
    if (archiveMatch && req.method === 'POST') {
      const id = archiveMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const url = requestUrl(req);
      const archived = url.searchParams.get('archived') !== 'false';
      const ok = await setResearchArchived(id, archived);
      if (!ok) {
        sendJson(res, 404, { error: 'Research not found' });
        return true;
      }
      sendJson(res, 200, { ok: true, id, archived });
      return true;
    }

    const deleteMatch = pathname.match(/^\/api\/research\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const id = deleteMatch[1];
      if (!isResearchId(id)) {
        sendJson(res, 400, { error: 'Invalid research id' });
        return true;
      }
      const deleted = await deleteResearch(id);
      if (!deleted) {
        sendJson(res, 404, { error: 'Research not found' });
        return true;
      }
      sendJson(res, 200, { deleted: true });
      return true;
    }

    if (pathname.includes('..')) {
      sendJson(res, 400, { error: 'Invalid path' });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Invalid JSON body' || message === 'Invalid provider id') {
      sendJson(res, 400, { error: message });
      return true;
    }
    if (message.startsWith('query is required') || message.startsWith('Prior research not found')) {
      sendJson(res, 400, { error: message });
      return true;
    }
    if (message.startsWith('No research model configured')) {
      sendJson(res, 400, { error: message });
      return true;
    }
    console.error('[research]', message);
    sendJson(res, 500, { error: message });
    return true;
  }
}

/** Connect middleware for Vite dev server. */
export function createResearchMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/research')) {
      next();
      return;
    }

    const handled = await handleResearchRequest(req, res, url);
    if (!handled) {
      next();
    }
  };
}
