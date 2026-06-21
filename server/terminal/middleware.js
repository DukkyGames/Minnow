/**
 * HTTP middleware for /api/terminal/* (SSE streaming command output).
 */

import path from 'node:path';
import { validateAllowedWorkspaceRoot } from '../chats-workspace/paths.js';
import { subscribeRun, getRun, createRun, cancelRun, getTerminalHistoryForChat, readRunLogTail } from '../terminal-runner.js';
import { resolveChatCwd } from '../workspace/chat-cwd.js';
import { getAvailableShellProfiles } from './shell-profiles.js';
import {
  createPtySession,
  destroyPtySession,
  resizePtySession,
  listPtySessionMeta,
  getPtyAvailability,
} from './pty-host.js';

const HEARTBEAT_MS = 15_000;

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

function writeSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
export async function handleTerminalRequest(req, res, pathname, projectRoot) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (pathname === '/api/terminal/run' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const command = body?.command;
      if (!command || typeof command !== 'string' || !command.trim()) {
        sendJson(res, 400, { error: 'command is required' });
        return true;
      }

      const source = body?.source === 'user' ? 'user' : 'agent';
      const chatId = typeof body?.chatId === 'string' ? body.chatId : undefined;
      const toolCallId =
        typeof body?.toolCallId === 'string' ? body.toolCallId : undefined;

      let base = projectRoot;
      if (body?.workspaceRoot != null) {
        if (typeof body.workspaceRoot !== 'string' || !body.workspaceRoot.trim()) {
          sendJson(res, 400, { error: 'Invalid workspaceRoot' });
          return true;
        }
        try {
          base = await validateAllowedWorkspaceRoot(body.workspaceRoot);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 400, { error: message });
          return true;
        }
      } else if (source === 'agent' && chatId) {
        const chatRoot = await resolveChatCwd(chatId);
        if (chatRoot) base = chatRoot;
      }

      const relativeCwd =
        typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : '';
      const cwd = relativeCwd ? path.resolve(base, relativeCwd) : base;

      const argv = Array.isArray(body?.args)
        ? body.args.filter((a) => typeof a === 'string')
        : [];
      const shell = body?.shell === true;

      const started = await createRun({
        command: command.trim(),
        args: argv,
        cwd,
        shell,
        source,
        chatId,
        toolCallId,
      });

      sendJson(res, 200, { runId: started.runId, startedAt: started.startedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
    return true;
  }

  const streamMatch = pathname.match(/^\/api\/terminal\/stream\/([^/]+)$/);
  if (streamMatch && req.method === 'GET') {
    const runId = streamMatch[1];
    const state = getRun(runId);
    if (!state) {
      sendJson(res, 404, { error: 'Run not found' });
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    const unsubscribe = subscribeRun(runId, (event) => {
      writeSse(res, event);
      if (event.type === 'exit' || event.type === 'error') {
        clearInterval(heartbeat);
        res.end();
      }
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return true;
  }

  const cancelMatch = pathname.match(/^\/api\/terminal\/cancel\/([^/]+)$/);
  if (cancelMatch && req.method === 'POST') {
    const ok = cancelRun(cancelMatch[1]);
    sendJson(res, 200, { ok });
    return true;
  }

  if (pathname === '/api/terminal/history' && req.method === 'GET') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const chatId = url.searchParams.get('chatId') ?? '';
    if (!chatId) {
      sendJson(res, 400, { error: 'chatId query parameter is required' });
      return true;
    }
    const runs = await getTerminalHistoryForChat(chatId);
    sendJson(res, 200, { runs });
    return true;
  }

  const logMatch = pathname.match(/^\/api\/terminal\/log\/([^/]+)$/);
  if (logMatch && req.method === 'GET') {
    const tail = await readRunLogTail(logMatch[1]);
    if (tail == null) {
      sendJson(res, 404, { error: 'Log not found' });
      return true;
    }
    sendJson(res, 200, { text: tail });
    return true;
  }

  if (pathname === '/api/terminal/shell-profiles' && req.method === 'GET') {
    const pty = getPtyAvailability();
    sendJson(res, 200, {
      profiles: getAvailableShellProfiles(),
      ptyAvailable: pty.available,
      ...(pty.error ? { ptyError: pty.error } : {}),
    });
    return true;
  }

  if (pathname === '/api/terminal/session' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const cwd =
        typeof body?.cwd === 'string' && body.cwd.trim()
          ? body.cwd.trim()
          : projectRoot;
      const chatId =
        typeof body?.chatId === 'string' ? body.chatId : null;
      const shellProfileId =
        typeof body?.shellProfileId === 'string' ? body.shellProfileId : undefined;
      const cols = typeof body?.cols === 'number' ? body.cols : 80;
      const rows = typeof body?.rows === 'number' ? body.rows : 24;

      const created = createPtySession({
        shellProfileId,
        cwd,
        cols,
        rows,
        chatId,
      });
      sendJson(res, 200, created);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('Maximum') ? 429 : 500;
      sendJson(res, status, { error: message });
    }
    return true;
  }

  if (pathname === '/api/terminal/sessions' && req.method === 'GET') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const chatId = url.searchParams.get('chatId') ?? undefined;
    const sessions = listPtySessionMeta(chatId ? { chatId } : {});
    sendJson(res, 200, { sessions });
    return true;
  }

  const resizeMatch = pathname.match(/^\/api\/terminal\/session\/([^/]+)\/resize$/);
  if (resizeMatch && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const cols = Number(body?.cols);
      const rows = Number(body?.rows);
      resizePtySession(resizeMatch[1], cols, rows);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 404, { error: message });
    }
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/terminal\/session\/([^/]+)$/);
  if (sessionMatch && req.method === 'DELETE') {
    destroyPtySession(sessionMatch[1]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * Vite connect middleware factory.
 * @param {string | (() => string)} resolveProjectRoot
 */
export function createTerminalMiddleware(resolveProjectRoot) {
  const getRoot =
    typeof resolveProjectRoot === 'function'
      ? resolveProjectRoot
      : () => resolveProjectRoot;

  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/api/terminal')) {
      next();
      return;
    }

    const handled = await handleTerminalRequest(req, res, url, getRoot());
    if (!handled) {
      sendJson(res, 404, { error: 'Not found' });
    }
  };
}
