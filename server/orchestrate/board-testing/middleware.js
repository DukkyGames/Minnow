/**
 * /api/orchestrate/board-testing/* — fake model host, seed board, log validation.
 */

import path from 'node:path';
import { FAKE_PROVIDER_ID } from '../../../scripts/fake-model-server.mjs';
import { listProviders } from '../../providers/store.js';
import { patchSessionState, readWholeSessionState } from '../../config/sessions-repo.js';
import { getWorkspaceRoot } from '../../workspace/root.js';
import {
  getFakeModelStatus,
  resetFakeModelScenario,
  startFakeModel,
  stopFakeModel,
} from './fake-model-host.js';
import { validateBoardLog } from './board-log-validate.js';
import { importTsModule } from './ts-import.js';
import { TEST_BOARD_GROUP_ID, TEST_BOARD_PLANNER_ID } from './constants.js';

const API_PREFIX = '/api/orchestrate/board-testing';

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 512_000) {
      throw new Error('payload too large');
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error('invalid JSON body');
  }
}

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function buildBoardTestingStatus() {
  const fakeModel = getFakeModelStatus();
  let providerRegistered = false;
  try {
    const { providers } = await listProviders();
    providerRegistered = providers.some((p) => p.id === FAKE_PROVIDER_ID);
  } catch {
    providerRegistered = false;
  }

  const state = readWholeSessionState();
  const workspacePath = getWorkspaceRoot();
  const { normalizeWorkspacePath } = await importTsModule(
    '../../../src/lib/normalize-workspace-path.ts',
  );
  const workspaceKey = normalizeWorkspacePath(workspacePath);
  const boardsInWorkspace = (state.groups ?? []).filter((group) => {
    if (normalizeWorkspacePath(group.workspacePath ?? '') !== workspaceKey) return false;
    return Boolean(group.orchestrateBoard) || Boolean(group.orchestratePlanPath?.trim());
  });

  const stablePlanner = (state.chats ?? []).find((c) => c.id === TEST_BOARD_PLANNER_ID);
  const stableGroup = (state.groups ?? []).find((g) => g.id === TEST_BOARD_GROUP_ID);

  return {
    ok: true,
    fakeModel,
    providerRegistered,
    seededBoard: {
      count: boardsInWorkspace.length,
      present: boardsInWorkspace.length > 0,
      stableTestBoardPresent: Boolean(stablePlanner && stableGroup),
      groupId: stableGroup?.id ?? null,
      plannerId: stablePlanner?.id ?? null,
      workspacePath,
      taskCount: stableGroup?.orchestrateBoard?.tasks?.length ?? null,
    },
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {Promise<boolean>}
 */
export async function handleBoardTestingRequest(req, res, pathname) {
  if (!pathname.startsWith(API_PREFIX)) {
    return false;
  }

  if (pathname === `${API_PREFIX}/status` && req.method === 'GET') {
    try {
      sendJson(res, 200, await buildBoardTestingStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === `${API_PREFIX}/fake-model/start` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const port =
        typeof body.port === 'number' && Number.isFinite(body.port) && body.port >= 0
          ? body.port
          : undefined;
      const fakeModel = await startFakeModel({ port });
      sendJson(res, 200, { ok: true, fakeModel });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === `${API_PREFIX}/fake-model/stop` && req.method === 'POST') {
    try {
      const fakeModel = await stopFakeModel();
      sendJson(res, 200, { ok: true, fakeModel });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === `${API_PREFIX}/seed` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const preset = body.preset === 'smoke' ? 'smoke' : 'quick';
      const mode =
        body.mode === 'auto' || body.mode === 'sequential' ? body.mode : 'manual';
      const workspacePath =
        typeof body.workspacePath === 'string' && body.workspacePath.trim()
          ? path.resolve(body.workspacePath.trim())
          : getWorkspaceRoot();

      const { installHeadlessLocalStorage } = await importTsModule(
        '../../../src/headless/server-context.ts',
      );
      const { normalizeWorkspacePath } = await importTsModule(
        '../../../src/lib/normalize-workspace-path.ts',
      );
      const { buildTestBoardSession, taskCountForPreset } = await importTsModule(
        '../../../src/dev/test-board-seed.ts',
      );

      installHeadlessLocalStorage();

      const { planner, group } = buildTestBoardSession({
        workspacePath,
        preset,
        mode,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
        autoStart: body.autoStart === true,
        stableIds: body.stableIds === true,
      });

      const existing = readWholeSessionState();
      const workspaceKey = normalizeWorkspacePath(planner.workspacePath);
      const lastByWorkspace = {
        ...(existing.lastActiveChatIdByWorkspace ?? {}),
        [workspaceKey]: planner.id,
      };

      patchSessionState({
        baseVersion: existing.version ?? 6,
        chats: [planner],
        groups: [group],
        scalars: {
          activeId: planner.id,
          activeBoardGroupId: group.id,
          lastActiveChatIdByWorkspace: lastByWorkspace,
        },
      });

      // Each seeded board expects builder nth=0 → board_report; reset when reusing the host.
      resetFakeModelScenario();

      sendJson(res, 200, {
        ok: true,
        groupId: group.id,
        plannerId: planner.id,
        workspacePath: planner.workspacePath,
        taskCount: taskCountForPreset(preset),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === `${API_PREFIX}/check-log` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : '';
      if (!groupId) {
        sendJson(res, 400, { ok: false, error: 'groupId is required' });
        return true;
      }

      let plan;
      if (body.plan != null) {
        if (typeof body.plan === 'string') {
          plan = JSON.parse(body.plan);
        } else {
          plan = body.plan;
        }
      }

      const result = await validateBoardLog({ groupId, plan });
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: message });
    }
    return true;
  }

  return false;
}

export function createBoardTestingMiddleware() {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith(API_PREFIX)) {
      next();
      return;
    }
    const handled = await handleBoardTestingRequest(req, res, url);
    if (!handled) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    }
  };
}
