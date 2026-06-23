/**
 * /api/orchestrate/* middleware — board log JSONL mirror endpoint.
 */

import { appendBoardLogLine, pruneBoardLogFiles } from './board-log-sink.js';

let pruneScheduled = false;

function schedulePruneOnce() {
  if (pruneScheduled) return;
  pruneScheduled = true;
  void pruneBoardLogFiles().catch(() => {});
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleOrchestrateRequest(req, res, pathname) {
  schedulePruneOnce();

  if (pathname === '/api/orchestrate/board-log' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 256_000) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
        return true;
      }
    }
    try {
      const parsed = JSON.parse(body || '{}');
      const groupId = typeof parsed.groupId === 'string' ? parsed.groupId.trim() : '';
      const event = parsed.event;
      if (!groupId || !event || typeof event !== 'object') {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'groupId and event required' }));
        return true;
      }
      await appendBoardLogLine(groupId, event);
      res.statusCode = 204;
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: message }));
    }
    return true;
  }

  return false;
}

export function createOrchestrateMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/orchestrate')) {
      next();
      return;
    }
    const handled = await handleOrchestrateRequest(req, res, url);
    if (!handled) next();
  };
}
