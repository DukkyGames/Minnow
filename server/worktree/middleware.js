/**
 * /api/worktree — board task isolation operations (MIN-275).
 * Programmatic (board-driven), not an LLM tool: create/merge/cleanup git worktrees.
 */

import {
  abortMerge,
  cleanupBoardWorktrees,
  checkMerged,
  checkWorktreeDirty,
  commitWorktree,
  createWorktree,
  ensureIntegration,
  listWorktrees,
  mergeIntoIntegration,
  refreshIntegrationDeps,
  removeWorktree,
  restoreIntegration,
  verifyIntegrationMerge,
} from './worktree-ops.js';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

const OPS = {
  ensure_integration: (a) => ensureIntegration(a),
  create: (a) => createWorktree(a),
  merge: (a) => mergeIntoIntegration(a),
  commit: (a) => commitWorktree(a),
  check_dirty: (a) => checkWorktreeDirty(a),
  check_merged: (a) => checkMerged(a),
  abort_merge: (a) => abortMerge(a),
  restore_integration: (a) => restoreIntegration(a),
  verify_integration: (a) => verifyIntegrationMerge(a),
  refresh_integration_deps: (a) => refreshIntegrationDeps(a),
  remove: (a) => removeWorktree(a),
  cleanup: (a) => cleanupBoardWorktrees(a),
  list: () => listWorktrees(),
  integration_stats: (a) => integrationStats(a),
  commit_integration: (a) => commitIntegration(a),
  push_integration: (a) => pushIntegration(a),
  open_pr: (a) => openPr(a),
};

export async function handleWorktreeRequest(req, res, pathname) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  if (pathname !== '/api/worktree' || req.method !== 'POST') {
    if (pathname.startsWith('/api/worktree')) {
      sendJson(res, 404, { error: 'Not found' });
      return true;
    }
    return false;
  }
  try {
    const body = await readJsonBody(req);
    const op = typeof body?.op === 'string' ? body.op : '';
    const handler = OPS[op];
    if (!handler) {
      sendJson(res, 400, { error: `Unknown worktree op: ${op || '(none)'}` });
      return true;
    }
    const result = await handler(body ?? {});
    sendJson(res, result?.ok === false ? 200 : 200, result);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { ok: false, error: message });
    return true;
  }
}

/** Vite connect middleware factory. */
export function createWorktreeMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/worktree')) {
      next();
      return;
    }
    const handled = await handleWorktreeRequest(req, res, parsed.pathname);
    if (!handled) next();
  };
}
