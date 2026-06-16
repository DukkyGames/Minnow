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
import {
  listEmailFolders,
  syncFolderMessages,
  testEmailConnection,
} from './transport.js';
import { triageMessage } from './triage.js';
import { draftReply, sendEmail, sendReplyVariant } from './smtp.js';
import {
  setMessageFlags,
  moveMessage,
  archiveMessage,
  deleteMessage,
  bulkMessageAction,
} from './mail-actions.js';
import { getOrBuildInboxSummary, generateReplyVariants } from './agent.js';
import { handleEmailEventsSse } from './events.js';
import {
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from './automations.js';
import { getFolderUnreadCounts } from './cache.js';

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

      if (url === '/api/email/events' && req.method === 'GET') {
        handleEmailEventsSse(req, res);
        return;
      }

      if (url === '/api/email/automations' && req.method === 'GET') {
        const rules = await listAutomations();
        sendJson(res, 200, { rules });
        return;
      }

      if (url === '/api/email/automations' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const rule = await createAutomation(body);
        sendJson(res, 201, { rule });
        return;
      }

      const automationMatch = url.match(/^\/api\/email\/automations\/([^/]+)$/);
      if (automationMatch) {
        const ruleId = decodeURIComponent(automationMatch[1]);
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const rule = await updateAutomation(ruleId, body);
          sendJson(res, 200, { rule });
          return;
        }
        if (req.method === 'DELETE') {
          await deleteAutomation(ruleId);
          sendJson(res, 200, { deleted: true });
          return;
        }
      }

      if (url === '/api/email/messages/bulk' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        if (!accountId) {
          sendJson(res, 400, { error: 'accountId is required' });
          return;
        }
        const result = await bulkMessageAction(accountId, body);
        sendJson(res, 200, result);
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
          const result = await testEmailConnection(accountId);
          sendJson(res, 200, result);
          return;
        }

        if (tail === 'folders' && req.method === 'GET') {
          const folders = await listEmailFolders(accountId);
          sendJson(res, 200, { folders });
          return;
        }

        if (tail === 'messages' && req.method === 'GET') {
          const params = parseQuery(req.url ?? '');
          const folder = params.get('folder') ?? undefined;
          const offset = Number(params.get('offset') ?? 0);
          const limit = Number(params.get('limit') ?? 50);
          const query = params.get('query') ?? undefined;
          const filter = params.get('filter') ?? undefined;
          const result = await listCachedMessages(accountId, { folder, offset, limit, query, filter });
          sendJson(res, 200, result);
          return;
        }

        if (tail === 'summary' && req.method === 'GET') {
          const summary = await getOrBuildInboxSummary(accountId);
          const unreadByFolder = await getFolderUnreadCounts(accountId);
          sendJson(res, 200, { summary, unreadByFolder });
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

      const flagsMatch = url.match(/^\/api\/email\/messages\/([^/]+)\/flags$/);
      if (flagsMatch && req.method === 'POST') {
        const messageKey = decodeURIComponent(flagsMatch[1]);
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        if (!accountId) {
          sendJson(res, 400, { error: 'accountId is required' });
          return;
        }
        const result = await setMessageFlags(accountId, messageKey, {
          seen: body.seen,
          flagged: body.flagged,
        });
        sendJson(res, 200, result);
        return;
      }

      const moveMatch = url.match(/^\/api\/email\/messages\/([^/]+)\/move$/);
      if (moveMatch && req.method === 'POST') {
        const messageKey = decodeURIComponent(moveMatch[1]);
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        const destFolder = String(body.destFolder ?? '').trim();
        if (!accountId || !destFolder) {
          sendJson(res, 400, { error: 'accountId and destFolder are required' });
          return;
        }
        const result = await moveMessage(accountId, messageKey, destFolder);
        sendJson(res, 200, result);
        return;
      }

      const archiveMatch = url.match(/^\/api\/email\/messages\/([^/]+)\/archive$/);
      if (archiveMatch && req.method === 'POST') {
        const messageKey = decodeURIComponent(archiveMatch[1]);
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        if (!accountId) {
          sendJson(res, 400, { error: 'accountId is required' });
          return;
        }
        const result = await archiveMessage(accountId, messageKey);
        sendJson(res, 200, result);
        return;
      }

      const variantsMatch = url.match(/^\/api\/email\/messages\/([^/]+)\/reply-variants$/);
      if (variantsMatch && req.method === 'POST') {
        const messageKey = decodeURIComponent(variantsMatch[1]);
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        const threadId = String(body.threadId ?? '').trim();
        if (!accountId || !threadId) {
          sendJson(res, 400, { error: 'accountId and threadId are required' });
          return;
        }
        const result = await generateReplyVariants(accountId, threadId, {
          messageKey,
          instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
        });
        sendJson(res, 200, result);
        return;
      }

      const variantSendMatch = url.match(
        /^\/api\/email\/messages\/([^/]+)\/reply-variants\/([^/]+)\/send$/,
      );
      if (variantSendMatch && req.method === 'POST') {
        const messageKey = decodeURIComponent(variantSendMatch[1]);
        const variantId = decodeURIComponent(variantSendMatch[2]);
        const body = await readJsonBody(req);
        const accountId = String(body.accountId ?? '').trim();
        const threadId = String(body.threadId ?? '').trim();
        if (!accountId || !threadId) {
          sendJson(res, 400, { error: 'accountId and threadId are required' });
          return;
        }
        if (!body.confirmed) {
          sendJson(res, 400, { error: 'Send requires explicit user confirmation (confirmed: true)' });
          return;
        }
        const result = await sendReplyVariant({
          accountId,
          threadId,
          messageKey,
          variantId,
          confirmed: true,
        });
        sendJson(res, 200, result);
        return;
      }

      const deleteMatch = url.match(/^\/api\/email\/messages\/([^/]+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        const messageKey = decodeURIComponent(deleteMatch[1]);
        const params = parseQuery(req.url ?? '');
        const accountId = String(params.get('accountId') ?? '').trim();
        if (!accountId) {
          sendJson(res, 400, { error: 'accountId query param is required' });
          return;
        }
        const permanent = params.get('permanent') === '1';
        const result = await deleteMessage(accountId, messageKey, { permanent });
        sendJson(res, 200, result);
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
