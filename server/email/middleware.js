/**
 * Email REST API middleware (/api/email/*).
 */

import { ensureMinnowLayout } from '../config/home.js';
import {
  createEmailAccount,
  deleteEmailAccount,
  getEmailAccount,
  listEmailAccounts,
  redactAccount,
  updateEmailAccount,
} from './accounts.js';
import { listCachedMessages, listCachedThread } from './cache.js';
import { listImapFolders, syncFolderMessages, testImapConnection } from './imap.js';
import { triageMessage } from './triage.js';
import { draftReply, sendEmail } from './smtp.js';

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

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
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

/** @param {string} url */
function parseQuery(url) {
  return new URL(url, 'http://localhost').searchParams;
}

/**
 * Match `/api/email/accounts/:id/...` segments.
 * @param {string} url
 */
function parseAccountPath(url) {
  const match = url.match(/^\/api\/email\/accounts\/([^/]+)(?:\/(.+))?$/);
  if (!match) {
    return null;
  }
  return { accountId: decodeURIComponent(match[1]), tail: match[2] ?? '' };
}

export function createEmailMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/email')) {
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

      if (url === '/api/email/ping' && req.method === 'GET') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url === '/api/email/accounts' && req.method === 'GET') {
        const accounts = await listEmailAccounts();
        sendJson(res, 200, { accounts: accounts.map(redactAccount) });
        return;
      }

      if (url === '/api/email/accounts' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const account = await createEmailAccount(body, body.password);
        sendJson(res, 201, { account: redactAccount(account) });
        return;
      }

      const accountPath = parseAccountPath(url);
      if (accountPath) {
        const { accountId, tail } = accountPath;

        if (!tail && req.method === 'PUT') {
          const body = await readJsonBody(req);
          const account = await updateEmailAccount(accountId, body, body.password);
          sendJson(res, 200, { account: redactAccount(account) });
          return;
        }

        if (!tail && req.method === 'DELETE') {
          await deleteEmailAccount(accountId);
          sendJson(res, 200, { deleted: true });
          return;
        }

        if (tail === 'test' && req.method === 'POST') {
          const result = await testImapConnection(accountId);
          sendJson(res, 200, result);
          return;
        }

        if (tail === 'folders' && req.method === 'GET') {
          const folders = await listImapFolders(accountId);
          sendJson(res, 200, { folders });
          return;
        }

        if (tail === 'messages' && req.method === 'GET') {
          const params = parseQuery(req.url ?? '');
          const folder = params.get('folder') ?? undefined;
          const offset = Number(params.get('offset') ?? 0);
          const limit = Number(params.get('limit') ?? 50);
          const query = params.get('query') ?? undefined;
          const result = await listCachedMessages(accountId, { folder, offset, limit, query });
          sendJson(res, 200, result);
          return;
        }

        if (tail === 'sync' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await syncFolderMessages(accountId, body);
          sendJson(res, 200, result);
          return;
        }

        const threadMatch = tail.match(/^threads\/([^/]+)$/);
        if (threadMatch && req.method === 'GET') {
          const threadId = decodeURIComponent(threadMatch[1]);
          const messages = await listCachedThread(accountId, threadId);
          sendJson(res, 200, { threadId, messages });
          return;
        }

        if (!tail && req.method === 'GET') {
          const account = await getEmailAccount(accountId);
          if (!account) {
            sendJson(res, 404, { error: 'Email account not found' });
            return;
          }
          sendJson(res, 200, { account: redactAccount(account) });
          return;
        }
      }

      const triageMatch = url.match(/^\/api\/email\/messages\/([^/]+)\/triage$/);
      if (triageMatch && req.method === 'POST') {
        const messageKey = decodeURIComponent(triageMatch[1]);
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        if (!accountId) {
          sendJson(res, 400, { error: 'accountId is required' });
          return;
        }
        const triage = await triageMessage(accountId, messageKey);
        sendJson(res, 200, { triage });
        return;
      }

      if (url === '/api/email/draft-reply' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const draft = await draftReply(body);
        sendJson(res, 200, { draft });
        return;
      }

      if (url === '/api/email/send' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await sendEmail(body);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Email request failed';
      sendJson(res, 400, { error: message });
    }
  };
}
