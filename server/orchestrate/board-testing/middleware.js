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
  getFakeModelRequestTail,
  getFakeModelScenario,
  configureFakeModelScenario,
  resetFakeModelScenario,
  startFakeModel,
  stopFakeModel,
} from './fake-model-host.js';
import { validateBoardLog } from './board-log-validate.js';
import { tailBoardLog } from './board-log-tail.js';
import { defaultScenarioRunManager } from './scenario-runner.js';
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

/** Load detached built-in scenario metadata and definitions for the Settings runner. */
async function listBoardScenarios() {
  const { getBoardScenario, listBoardScenarioMetadata } = await importTsModule(
    '../../../src/dev/orchestrate-scenarios/index.ts',
  );
  return listBoardScenarioMetadata().map((metadata) => ({
    ...metadata,
    scenario: getBoardScenario(metadata.id),
  }));
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {{ scenarioRunManager?: import('./scenario-runner.js').ScenarioRunManager }} [options]
 * @returns {Promise<boolean>}
 */
export async function handleBoardTestingRequest(req, res, pathname, options = {}) {
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

  if (pathname === `${API_PREFIX}/scenarios` && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, scenarios: await listBoardScenarios() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === `${API_PREFIX}/fake-model/start` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (
        body.port != null &&
        (typeof body.port !== 'number' ||
          !Number.isSafeInteger(body.port) ||
          body.port < 0 ||
          body.port > 65_535)
      ) {
        sendJson(res, 400, { ok: false, error: 'port must be an integer between 0 and 65535' });
        return true;
      }
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

  if (pathname === `${API_PREFIX}/fake-model/scenario` && req.method === 'GET') {
    sendJson(res, 200, { ok: true, scenario: getFakeModelScenario() });
    return true;
  }

  if (pathname === `${API_PREFIX}/fake-model/scenario` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const scenario = configureFakeModelScenario(body.scenario ?? body);
      sendJson(res, 200, { ok: true, scenario });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: message });
    }
    return true;
  }

  if (pathname === `${API_PREFIX}/fake-model/requests` && req.method === 'GET') {
    const requestUrl = new URL(req.url ?? pathname, 'http://127.0.0.1');
    const rawLimit = requestUrl.searchParams.get('limit');
    const limit = rawLimit == null ? 20 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      sendJson(res, 400, { ok: false, error: 'limit must be an integer between 1 and 200' });
      return true;
    }
    sendJson(res, 200, { ok: true, requests: getFakeModelRequestTail({ limit }) });
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
        body.mode === 'afk' || body.mode === 'auto' || body.mode === 'sequential'
          ? body.mode
          : 'manual';
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

  if (
    (pathname === `${API_PREFIX}/board-log/tail` || pathname === `${API_PREFIX}/logs/tail`) &&
    req.method === 'GET'
  ) {
    try {
      const requestUrl = new URL(req.url ?? pathname, 'http://127.0.0.1');
      const groupId = requestUrl.searchParams.get('groupId') ?? '';
      const rawLimit = requestUrl.searchParams.get('limit');
      const limit = rawLimit == null ? 100 : Number(rawLimit);
      const result = await tailBoardLog({ groupId, limit });
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, message === 'board log not found' ? 404 : 400, {
        ok: false,
        error: message,
      });
    }
    return true;
  }

  const manager = options.scenarioRunManager ?? defaultScenarioRunManager;

  if (
    (pathname === `${API_PREFIX}/runs/prepare` || pathname === `${API_PREFIX}/run/prepare`) &&
    req.method === 'POST'
  ) {
    try {
      const run = await manager.prepare(await readJsonBody(req));
      sendJson(res, 201, { ok: true, run });
    } catch (err) {
      sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const iterationMatch = pathname.match(
    new RegExp(`^${API_PREFIX}/runs?/([^/]+)/iterations$`),
  );
  if (iterationMatch && req.method === 'POST') {
    try {
      const run = await manager.submitIteration(
        iterationMatch[1],
        await readJsonBody(req),
      );
      sendJson(res, 200, { ok: true, run });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message === 'run not found'
          ? 404
          : /only be submitted|already in progress|expected iteration|expected seed/.test(message)
            ? 409
            : 400;
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  const runMatch = pathname.match(
    new RegExp(`^${API_PREFIX}/runs?/([^/]+)/(start|stop|status|results|replay)$`),
  );
  if (runMatch) {
    const [, runId, action] = runMatch;
    const expectedMethod = action === 'status' || action === 'results' ? 'GET' : 'POST';
    if (req.method !== expectedMethod) return false;
    try {
      let payload;
      if (action === 'start') payload = await manager.start(runId);
      else if (action === 'stop') payload = await manager.stop(runId);
      else if (action === 'status') payload = await manager.status(runId);
      else if (action === 'results') payload = await manager.results(runId);
      else {
        const body = await readJsonBody(req);
        const iteration =
          body.iteration == null ? undefined : Number(body.iteration);
        if (iteration != null && (!Number.isSafeInteger(iteration) || iteration < 0)) {
          throw new Error('iteration must be a non-negative integer');
        }
        payload = await manager.replay(runId, iteration);
      }
      if (!payload) {
        sendJson(res, 404, { ok: false, error: 'run not found' });
      } else {
        sendJson(res, action === 'replay' ? 201 : 200, {
          ok: true,
          [action === 'results' ? 'results' : 'run']: payload,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'run not found' ? 404 : /cannot start|only terminal/.test(message) ? 409 : 400;
      sendJson(res, status, { ok: false, error: message });
    }
    return true;
  }

  return false;
}

/** @param {{ scenarioRunManager?: import('./scenario-runner.js').ScenarioRunManager }} [options] */
export function createBoardTestingMiddleware(options = {}) {
  return async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith(API_PREFIX)) {
      next();
      return;
    }
    const handled = await handleBoardTestingRequest(req, res, url, options);
    if (!handled) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    }
  };
}
