/**
 * HTTP handlers for /api/brain/code/* (code index status, reindex, queries).
 */

import {
  callsOf,
  explainSymbol,
  findSymbol,
  loadBrainCodeConfig,
  queryCodeStatus,
  readSymbol,
  ensureWarmCodeIndex,
  repoMap,
  resolveRepoKey,
  whoCalls,
} from './query.js';
import { saveBrainConfig } from '../store.js';
import { clearCodeIndex } from './schema.js';
import {
  getGitHookStatus,
  installGitHook,
  runCascade,
  uninstallGitHook,
} from './cascade.js';

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
 * Handle /api/brain/code/* requests.
 * @returns {Promise<boolean>} true when handled
 */
export async function handleCodeIndexRequest(req, res, pathname) {
  if (!pathname.startsWith('/api/brain/code')) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    const code = await loadBrainCodeConfig();
    if (!code.enabled && pathname !== '/api/brain/code/status') {
      sendJson(res, 400, { error: 'Brain code index is disabled in config.brain.code' });
      return true;
    }

    if (pathname === '/api/brain/code/status' && req.method === 'GET') {
      sendJson(res, 200, await queryCodeStatus());
      return true;
    }

    if (pathname === '/api/brain/code/config' && req.method === 'GET') {
      const code = await loadBrainCodeConfig();
      sendJson(res, 200, { code });
      return true;
    }

    if (pathname === '/api/brain/code/config' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const brain = await saveBrainConfig({ code: body });
      sendJson(res, 200, { code: brain.code });
      return true;
    }

    if (pathname === '/api/brain/code/reindex' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const files = Array.isArray(body.files)
        ? body.files.map((f) => String(f))
        : undefined;
      const result = await runCascade({
        trigger: 'manual',
        files,
        codeConfig: code,
        force: true,
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (pathname === '/api/brain/code/clear' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (body.confirmed !== true) {
        sendJson(res, 400, { error: 'confirmed: true is required' });
        return true;
      }
      const result = clearCodeIndex({
        workspaceKey: body.workspaceKey !== undefined ? String(body.workspaceKey) : undefined,
        all: body.all === true,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/brain/code/cascade' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const files = Array.isArray(body.files)
        ? body.files.map((f) => String(f))
        : undefined;
      const trigger =
        body.trigger === 'git-hook' ||
        body.trigger === 'workspace-switch' ||
        body.trigger === 'lazy-query'
          ? body.trigger
          : 'manual';
      const result = await runCascade({
        trigger,
        files,
        codeConfig: code,
        force: body.force === true,
      });
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (pathname === '/api/brain/code/git-hook/status' && req.method === 'GET') {
      sendJson(res, 200, await getGitHookStatus());
      return true;
    }

    if (pathname === '/api/brain/code/git-hook/install' && req.method === 'POST') {
      const result = await installGitHook();
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (pathname === '/api/brain/code/git-hook/uninstall' && req.method === 'POST') {
      const result = await uninstallGitHook();
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    if (pathname === '/api/brain/code/find-symbol' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const url = new URL(req.url ?? '', 'http://localhost');
      const query = url.searchParams.get('query') ?? body.query ?? '';
      const limit = Number(url.searchParams.get('limit') ?? body.limit ?? 20);
      sendJson(res, 200, await findSymbol(String(query), limit));
      return true;
    }

    if (pathname === '/api/brain/code/repo-map' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const url = new URL(req.url ?? '', 'http://localhost');
      const focus = url.searchParams.get('focus') ?? body.focus ?? undefined;
      const tokenBudget = Number(
        url.searchParams.get('tokenBudget') ?? body.tokenBudget ?? body.token_budget ?? 0,
      );
      const repoParam = body.repo ?? url.searchParams.get('repo') ?? undefined;
      const repo = resolveRepoKey(repoParam);
      const ensureIndexed =
        body.ensureIndexed === true ||
        url.searchParams.get('ensureIndexed') === 'true' ||
        url.searchParams.get('ensureIndexed') === '1';
      if (ensureIndexed) {
        await ensureWarmCodeIndex(repo);
      }
      const profile =
        body.profile === 'injection' || url.searchParams.get('profile') === 'injection'
          ? 'injection'
          : 'default';
      const map = await repoMap({
        repo,
        focus: focus ? String(focus) : undefined,
        tokenBudget: tokenBudget > 0 ? tokenBudget : undefined,
        focusFiles: Array.isArray(body.focusFiles) ? body.focusFiles.map(String) : undefined,
        profile,
      });
      sendJson(res, 200, map);
      return true;
    }

    if (pathname === '/api/brain/code/who-calls' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const url = new URL(req.url ?? '', 'http://localhost');
      const symbol = url.searchParams.get('symbol') ?? body.symbol ?? '';
      sendJson(res, 200, await whoCalls(String(symbol)));
      return true;
    }

    if (pathname === '/api/brain/code/calls-of' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const url = new URL(req.url ?? '', 'http://localhost');
      const symbol = url.searchParams.get('symbol') ?? body.symbol ?? '';
      sendJson(res, 200, await callsOf(String(symbol)));
      return true;
    }

    if (pathname === '/api/brain/code/read-symbol' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const url = new URL(req.url ?? '', 'http://localhost');
      const symbol = url.searchParams.get('symbol') ?? body.symbol ?? '';
      sendJson(res, 200, await readSymbol(String(symbol)));
      return true;
    }

    if (pathname === '/api/brain/code/explain' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const url = new URL(req.url ?? '', 'http://localhost');
      const symbol = url.searchParams.get('symbol') ?? body.symbol ?? '';
      sendJson(res, 200, await explainSymbol(String(symbol)));
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
        ? err.statusCode
        : 500;
    sendJson(res, status, { error: message });
    return true;
  }
}
