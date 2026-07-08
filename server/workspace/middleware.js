/**
 * /api/workspace — get, set, and pick the AI workspace folder.
 */

import {
  buildRecentWorkspaceList,
  getWorkspaceInfo,
  getWorkspaceRoot,
  removeRecentWorkspacePath,
  setWorkspaceRoot,
  validateWorkspacePath,
} from './root.js';
import {
  browseWorkspaceFolders,
  createWorkspaceSubfolder,
  ensureDefaultProjectsParent,
} from './browse.js';
import { pickWorkspaceFolder } from './pick-folder.js';
import { countWorkspaceLoc } from './loc.js';
import {
  getDevServerStatus,
  readStartupGuide,
  startDevServer,
  stopDevServer,
} from '../dev-server/manager.js';
import { readDevServerSettings, writeDevServerSettings } from '../dev-server/settings.js';
import { getWorkspaceGitStatus } from './git-status.js';
import { ensureBaselineGitignore } from './baseline-gitignore.js';

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
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {URLSearchParams} [searchParams]
 * @returns {Promise<boolean>}
 */
export async function handleWorkspaceRequest(req, res, pathname, searchParams = new URLSearchParams()) {

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/workspace/browse' && req.method === 'GET') {
      const browsePath = searchParams.get('path') ?? '';
      const listing = await browseWorkspaceFolders(browsePath);
      sendJson(res, 200, { ok: true, ...listing });
      return true;
    }

    if (pathname === '/api/workspace/mkdir' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const parentPath = body?.parentPath;
      const name = body?.name;
      if (typeof parentPath !== 'string' || !parentPath.trim()) {
        sendJson(res, 400, { error: 'parentPath is required' });
        return true;
      }
      if (typeof name !== 'string' || !name.trim()) {
        sendJson(res, 400, { error: 'name is required' });
        return true;
      }
      const created = await createWorkspaceSubfolder(parentPath, name);
      sendJson(res, 201, { ok: true, ...created });
      return true;
    }

    if (pathname === '/api/workspace/git-status' && req.method === 'GET') {
      const workspaceRoot = searchParams.get('workspaceRoot')?.trim() || undefined;
      const status = await getWorkspaceGitStatus(workspaceRoot);
      sendJson(res, 200, { ok: true, ...status });
      return true;
    }

    if (pathname === '/api/workspace/ensure-baseline-gitignore' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const workspaceRoot =
        typeof body?.workspaceRoot === 'string' && body.workspaceRoot.trim()
          ? body.workspaceRoot.trim()
          : undefined;
      const result = await ensureBaselineGitignore(workspaceRoot);
      if (!result.ok) {
        sendJson(res, 400, { ok: false, created: false, error: result.error ?? 'failed' });
        return true;
      }
      sendJson(res, 200, { ok: true, created: result.created, path: result.path });
      return true;
    }

    if (pathname === '/api/workspace/loc' && req.method === 'GET') {
      const result = await countWorkspaceLoc();
      if (!result.ok) {
        sendJson(res, 200, { ok: false, lines: null, files: null, error: result.error ?? 'unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, lines: result.lines, files: result.files });
      return true;
    }

    if (pathname === '/api/workspace/startup' && req.method === 'GET') {
      const startup = await readStartupGuide();
      const status = await getDevServerStatus();
      sendJson(res, 200, {
        ok: true,
        exists: startup.exists,
        parsed: Boolean(startup.guide),
        guide: startup.guide,
        parseError: startup.parseError ?? null,
        status: status.status,
        runId: status.runId,
        error: status.error,
      });
      return true;
    }

    if (pathname === '/api/workspace/dev-server/status' && req.method === 'GET') {
      const status = await getDevServerStatus();
      sendJson(res, 200, { ok: true, ...status });
      return true;
    }

    if (pathname === '/api/workspace/dev-server/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (body?.port != null || body?.network != null) {
        await writeDevServerSettings(getWorkspaceRoot(), {
          port: body?.port,
          network: body?.network,
        });
      }
      const result = await startDevServer();
      sendJson(res, result.ok ? 200 : 400, result);
      return true;
    }

    if (pathname === '/api/workspace/dev-server/stop' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const workspaceRoot =
        typeof body?.workspaceRoot === 'string' && body.workspaceRoot.trim()
          ? body.workspaceRoot.trim()
          : undefined;
      const result = await stopDevServer(workspaceRoot);
      sendJson(res, 200, result);
      return true;
    }

    if (pathname === '/api/workspace/dev-server/settings' && req.method === 'GET') {
      const settings = await readDevServerSettings(getWorkspaceRoot());
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (pathname === '/api/workspace/dev-server/settings' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const settings = await writeDevServerSettings(getWorkspaceRoot(), {
        port: body?.port,
        network: body?.network,
      });
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (pathname === '/api/workspace' && req.method === 'GET') {
      const recent = await buildRecentWorkspaceList();
      const newProjectParent = await ensureDefaultProjectsParent();
      sendJson(res, 200, { ok: true, ...getWorkspaceInfo(), recent, newProjectParent });
      return true;
    }

    if (pathname === '/api/workspace/recent' && req.method === 'DELETE') {
      const body = await readJsonBody(req);
      const userPath = body?.path;
      if (typeof userPath !== 'string' || !userPath.trim()) {
        sendJson(res, 400, { error: 'path is required' });
        return true;
      }
      await removeRecentWorkspacePath(userPath);
      const recent = await buildRecentWorkspaceList();
      sendJson(res, 200, { ok: true, recent });
      return true;
    }

    if (pathname === '/api/workspace' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const userPath = body?.path;
      if (typeof userPath !== 'string' || !userPath.trim()) {
        sendJson(res, 400, { error: 'path is required' });
        return true;
      }
      const resolved = await setWorkspaceRoot(userPath);
      sendJson(res, 200, {
        ok: true,
        path: resolved,
        label: getWorkspaceInfo().label,
        isDefault: getWorkspaceInfo().isDefault,
      });
      return true;
    }

    if (pathname === '/api/workspace/pick' && req.method === 'POST') {
      const pick = await pickWorkspaceFolder();
      if (pick.error) {
        sendJson(res, 500, { error: pick.error, cancelled: false });
        return true;
      }
      if (pick.cancelled || !pick.path) {
        sendJson(res, 200, { ok: true, cancelled: true, path: null });
        return true;
      }
      const resolved = await validateWorkspacePath(pick.path);
      await setWorkspaceRoot(resolved);
      sendJson(res, 200, {
        ok: true,
        cancelled: false,
        path: resolved,
        label: getWorkspaceInfo().label,
        isDefault: getWorkspaceInfo().isDefault,
      });
      return true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
    return true;
  }

  if (pathname.startsWith('/api/workspace')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

/** Vite connect middleware factory. */
export function createWorkspaceMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/workspace')) {
      next();
      return;
    }
    const handled = await handleWorkspaceRequest(req, res, parsed.pathname, parsed.searchParams);
    if (!handled) {
      next();
    }
  };
}
