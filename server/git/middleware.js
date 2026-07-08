/**
 * /api/git — programmatic git operations (MIN-198).
 */

import {
  branches,
  checkout,
  checkoutDetach,
  cherryPick,
  commit,
  createTag,
  deleteBranch,
  diff,
  discard,
  fetch,
  log,
  merge,
  pull,
  push,
  rebase,
  remoteUrl,
  show,
  stage,
  stageAll,
  stashApply,
  stashDrop,
  stashList,
  stashPop,
  stashPush,
  status,
  unstage,
  worktreeAdd,
  worktreeRemove,
} from './git-ops.js';

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
  status: (a) => status(a),
  diff: (a) => diff(a),
  stage: (a) => stage(a),
  stageAll: (a) => stageAll(a),
  unstage: (a) => unstage(a),
  discard: (a) => discard(a),
  commit: (a) => commit(a),
  push: (a) => push(a),
  pull: (a) => pull(a),
  fetch: (a) => fetch(a),
  log: (a) => log(a),
  branches: (a) => branches(a),
  checkout: (a) => checkout(a),
  checkoutDetach: (a) => checkoutDetach(a),
  createTag: (a) => createTag(a),
  deleteBranch: (a) => deleteBranch(a),
  remoteUrl: (a) => remoteUrl(a),
  worktreeAdd: (a) => worktreeAdd(a),
  worktreeRemove: (a) => worktreeRemove(a),
  show: (a) => show(a),
  merge: (a) => merge(a),
  rebase: (a) => rebase(a),
  stashList: (a) => stashList(a),
  stashPush: (a) => stashPush(a),
  stashPop: (a) => stashPop(a),
  stashApply: (a) => stashApply(a),
  stashDrop: (a) => stashDrop(a),
  cherryPick: (a) => cherryPick(a),
};

export async function handleGitRequest(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  if (pathname !== '/api/git' || req.method !== 'POST') {
    if (pathname.startsWith('/api/git')) {
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
      sendJson(res, 400, { error: `Unknown git op: ${op || '(none)'}` });
      return true;
    }
    const result = await handler(body ?? {});
    sendJson(res, 200, result);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { ok: false, error: message });
    return true;
  }
}

/** Vite connect middleware factory. */
export function createGitMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/git')) {
      next();
      return;
    }
    const handled = await handleGitRequest(req, res, parsed.pathname);
    if (!handled) next();
  };
}
