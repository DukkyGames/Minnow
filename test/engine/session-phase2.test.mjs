/**
 * Session Engine Phase 2 (MIN-360): board commands + stream-end bus + drive gate.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleConfigRequest } from '../../server/config/middleware.js';
import { handleSessionRequest } from '../../server/session/middleware.js';
import { resetSessionRevStoreForTests } from '../../server/session/rev-store.js';
import { resetSessionSseForTests } from '../../server/session/sse.js';
import { resetBoardDriverLeaseForTests } from '../../server/session/lease.js';
import {
  resetSessionEngineForTests,
  ensureSessionEngineBooted,
  getEngineSessionState,
  commitEngineState,
} from '../../server/session/engine.js';
import { resetBoardLoaderForTests } from '../../server/session/board-loader.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  httpRequest,
  readFixture,
  setTestHome,
  rmTestHome,
} from '../config/test-helpers.js';

/** @type {Record<string, unknown>} */
let defaultSessionFixture;

function createPhase2TestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleSessionRequest(req, res, url.pathname).then((sessionHandled) => {
      if (sessionHandled) return;
      void handleConfigRequest(req, res, url.pathname).then((configHandled) => {
        if (!configHandled) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });
  });
}

function httpRequestWithHeaders(baseUrl, method, pathname, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({
            status: res.statusCode,
            json,
            text,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('session engine phase 2 board (MIN-360)', () => {
  /** @type {string | undefined} */
  let home;
  /** @type {http.Server | undefined} */
  let server;
  /** @type {string | undefined} */
  let baseUrl;
  /** @type {string | undefined} */
  let prevEngineFlag;

  before(async () => {
    home = setTestHome(process.env, 'minnow-session-phase2');
    defaultSessionFixture = JSON.parse(await readFixture('expected-sessions-state.json'));
    prevEngineFlag = process.env.MINNOW_SERVER_ENGINE;
    process.env.MINNOW_SERVER_ENGINE = '1';
    resetSessionRevStoreForTests();
    resetSessionSseForTests();
    resetBoardDriverLeaseForTests();
    resetSessionEngineForTests();
    resetBoardLoaderForTests();
    server = createPhase2TestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    resetBoardDriverLeaseForTests();
    resetBoardLoaderForTests();
    process.env.MINNOW_SERVER_ENGINE = '1';
  });

  after(async () => {
    try {
      const { deactivateEngineBoardHost } = await import(
        '../../src/session-engine/board-host.ts'
      );
      await deactivateEngineBoardHost();
    } catch {
      /* host may not have loaded */
    }
    resetSessionSseForTests();
    resetBoardDriverLeaseForTests();
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    resetBoardLoaderForTests();
    if (prevEngineFlag === undefined) delete process.env.MINNOW_SERVER_ENGINE;
    else process.env.MINNOW_SERVER_ENGINE = prevEngineFlag;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    closeSessionsDb();
    if (home) rmTestHome(home);
  });

  test('board_set_autonomy + board_start sets autoRunning via commands', async () => {
    const state = structuredClone(defaultSessionFixture);
    const groupId = 'grp_board_phase2_test';
    const plannerId = state.chats[0].id;
    state.groups = [
      {
        id: groupId,
        name: 'Board',
        kind: 'orchestrate',
        plannerChatId: plannerId,
        chatIds: [plannerId],
        orchestrateBoard: {
          planPath: 'documentation/plans/x.md',
          tasks: [
            {
              id: 'W1-A',
              title: 'Task A',
              wave: 'W1',
              category: 'build',
              status: 'planned',
            },
          ],
          waves: [{ id: 'W1', status: 'planned' }],
          startedAt: 1,
          lastUpdatedAt: 1,
          executionMode: 'manual',
          autoRunning: false,
          maxConcurrentTasks: 1,
        },
      },
    ];
    const planner = state.chats.find((c) => c.id === plannerId);
    planner.modeId = 'orchestrate';
    planner.boardGroupId = groupId;
    planner.groupId = groupId;
    planner.modelId = 'test-model';

    await httpRequest(baseUrl, 'PUT', '/api/config/sessions', state);
    await ensureSessionEngineBooted();

    const autonomy = await httpRequestWithHeaders(
      baseUrl,
      'POST',
      '/api/session/commands',
      { type: 'board_set_autonomy', groupId, level: 'auto' },
    );
    assert.equal(autonomy.status, 202, JSON.stringify(autonomy.json));
    assert.equal(autonomy.json.accepted, true);

    const start = await httpRequestWithHeaders(
      baseUrl,
      'POST',
      '/api/session/commands',
      { type: 'board_start', groupId },
    );
    assert.equal(start.status, 202, JSON.stringify(start.json));

    const engineState = getEngineSessionState();
    const group = engineState.groups.find((g) => g.id === groupId);
    assert.ok(group?.orchestrateBoard);
    assert.equal(group.orchestrateBoard.executionMode, 'auto');
    assert.equal(group.orchestrateBoard.autoRunning, true);

    const stop = await httpRequestWithHeaders(
      baseUrl,
      'POST',
      '/api/session/commands',
      { type: 'board_stop', groupId },
    );
    assert.equal(stop.status, 202);
    const afterStop = getEngineSessionState();
    const stopped = afterStop.groups.find((g) => g.id === groupId);
    // Schema omits autoRunning when false — treat missing as stopped.
    assert.ok(!stopped.orchestrateBoard.autoRunning);
  });

  test('set_model stamps board preferredModelId', async () => {
    const state = structuredClone(defaultSessionFixture);
    const groupId = 'grp_board_model_test';
    const plannerId = state.chats[0].id;
    state.groups = [
      {
        id: groupId,
        name: 'Board',
        kind: 'orchestrate',
        plannerChatId: plannerId,
        chatIds: [plannerId],
        orchestrateBoard: {
          planPath: 'documentation/plans/x.md',
          tasks: [
            {
              id: 'W1-A',
              title: 'Task A',
              wave: 'W1',
              category: 'build',
              status: 'planned',
            },
          ],
          waves: [{ id: 'W1', status: 'planned' }],
          startedAt: 1,
          lastUpdatedAt: 1,
          executionMode: 'manual',
        },
      },
    ];
    state.chats[0].boardGroupId = groupId;
    state.chats[0].groupId = groupId;

    await httpRequest(baseUrl, 'PUT', '/api/config/sessions', state);
    await ensureSessionEngineBooted();

    const res = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'set_model',
      chatId: plannerId,
      groupId,
      providerId: 'lmstudio',
      modelId: 'qwen-board',
    });
    assert.equal(res.status, 202, JSON.stringify(res.json));

    const engineState = getEngineSessionState();
    const group = engineState.groups.find((g) => g.id === groupId);
    assert.equal(group.orchestrateBoard.preferredModelId, 'qwen-board');
    assert.equal(group.orchestrateBoard.preferredProviderId, 'lmstudio');
    const chat = engineState.chats.find((c) => c.id === plannerId);
    assert.equal(chat.modelId, 'qwen-board');
  });

  test('flag off: board commands return 503', async () => {
    process.env.MINNOW_SERVER_ENGINE = '0';
    resetSessionEngineForTests();
    const res = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'board_start',
      groupId: 'x',
    });
    assert.equal(res.status, 503);
    process.env.MINNOW_SERVER_ENGINE = '1';
  });

  test('board_init command creates orchestrate board on engine state', async () => {
    const state = structuredClone(defaultSessionFixture);
    const plannerId = state.chats[0].id;
    state.chats[0].modeId = 'orchestrate';
    await httpRequest(baseUrl, 'PUT', '/api/config/sessions', state);
    await ensureSessionEngineBooted();

    const res = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'board_init',
      plannerChatId: plannerId,
      planPath: 'documentation/plans/phase2-init.md',
      tasks: [
        {
          id: 'W1-A',
          title: 'Init task',
          wave: 'W1',
          category: 'build',
        },
      ],
      waves: [{ id: 'W1' }],
    });
    assert.equal(res.status, 202, JSON.stringify(res.json));

    const engineState = getEngineSessionState();
    const group = (engineState.groups ?? []).find((g) => g.orchestrateBoard);
    assert.ok(group?.orchestrateBoard, 'expected board group after board_init');
    assert.equal(group.orchestrateBoard.planPath, 'documentation/plans/phase2-init.md');
    assert.equal(group.orchestrateBoard.tasks.length, 1);
    assert.equal(group.orchestrateBoard.tasks[0].id, 'W1-A');
  });

  test('engine board host can run board_init tool in-process (kickoff path)', async () => {
    const state = structuredClone(defaultSessionFixture);
    const plannerId = state.chats[0].id;
    state.chats[0].modeId = 'orchestrate';
    await commitEngineState(state);
    await ensureSessionEngineBooted();

    const { activateEngineBoardHost, deactivateEngineBoardHost } = await import(
      '../../src/session-engine/board-host.ts'
    );
    const { executeBoardTool, setBoardExecutorContext } = await import(
      '../../src/tools/board-tools.ts'
    );
    const { setSessionStateForEngineHost } = await import('../../src/state/sessions.ts');

    await activateEngineBoardHost();
    setSessionStateForEngineHost(getEngineSessionState());
    setBoardExecutorContext({ chatId: plannerId });
    try {
      const content = await executeBoardTool(
        'board_init',
        {
          plan_path: 'documentation/plans/tool-init.md',
          tasks: [
            {
              id: 'W1-B',
              title: 'Tool init',
              wave: 'W1',
              category: 'build',
            },
          ],
          waves: [{ id: 'W1' }],
        },
        { chatId: plannerId },
      );
      assert.ok(!content.startsWith('Error:'), content);
      const engineState = getEngineSessionState();
      const group = (engineState.groups ?? []).find((g) => g.orchestrateBoard);
      assert.ok(group?.orchestrateBoard);
      assert.equal(group.orchestrateBoard.planPath, 'documentation/plans/tool-init.md');
      assert.equal(group.orchestrateBoard.tasks[0].id, 'W1-B');
    } finally {
      setBoardExecutorContext(null);
      await deactivateEngineBoardHost();
    }
  });
});

describe('session-engine stream-bus (MIN-360)', () => {
  test('notifyChatStreamEnded delivers to subscribers in-process', async () => {
    const {
      subscribeChatStreamEnd,
      notifyChatStreamEnded,
      resetStreamBusForTests,
    } = await import('../../src/session-engine/stream-bus.ts');
    resetStreamBusForTests();
    /** @type {string[]} */
    const ended = [];
    const unsub = subscribeChatStreamEnd((id) => ended.push(id));
    notifyChatStreamEnded('chat-a');
    notifyChatStreamEnded('');
    assert.deepEqual(ended, ['chat-a']);
    unsub();
    notifyChatStreamEnded('chat-b');
    assert.deepEqual(ended, ['chat-a']);
    resetStreamBusForTests();
  });
});

describe('board-driver-gate (MIN-360)', () => {
  test('engine host owns drive; flag-on client does not', async () => {
    const {
      canDriveOrchestrateBoard,
      setEngineOwnsBoardDrive,
      setBoardDriverLeaseProbe,
      setServerEngineFlagProbe,
    } = await import('../../src/state/board-driver-gate.ts');

    setEngineOwnsBoardDrive(false);
    setBoardDriverLeaseProbe(null);
    setServerEngineFlagProbe(null);
    assert.equal(canDriveOrchestrateBoard(), true);

    setServerEngineFlagProbe(() => true);
    assert.equal(canDriveOrchestrateBoard(), false);

    setEngineOwnsBoardDrive(true);
    assert.equal(canDriveOrchestrateBoard(), true);

    setEngineOwnsBoardDrive(false);
    setServerEngineFlagProbe(null);
  });
});
