/**
 * Session Engine Phase 3 (MIN-361): engine-hosted controller registry + live SSE slice.
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
import { resetControllerLoaderForTests } from '../../server/session/controller-loader.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  httpRequest,
  readFixture,
  setTestHome,
  rmTestHome,
} from '../config/test-helpers.js';
import { resetSubAgentOrchestrator } from '../../src/agents/orchestrator.ts';
import { resetSubAgentConfigCache } from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunnerFactory,
  setSubAgentRunnerFactory,
} from '../../src/agents/sub-agent-runner.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import { createMockSubAgentRunner } from '../sub-agents/test-helpers.mts';
import { flushLiveSubAgentPublishForTests } from '../../src/agents/controller/live-publish.ts';
import {
  deactivateEngineControllerHost,
  resetEngineControllerHostBootForTests,
} from '../../src/session-engine/controller-host.ts';
import { setEngineOwnsController } from '../../src/agents/controller/host-gate.ts';

/** @type {Record<string, unknown>} */
let defaultSessionFixture;

function createPhase3TestServer() {
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

/**
 * Open an SSE subscriber and collect patch events that include liveSubAgentRuns.
 * @param {string} baseUrl
 * @param {{ minPatches?: number, timeoutMs?: number }} [opts]
 */
function collectLiveRunPatches(baseUrl, opts = {}) {
  const minPatches = opts.minPatches ?? 1;
  const timeoutMs = opts.timeoutMs ?? 8000;
  return new Promise((resolve, reject) => {
    const url = new URL('/api/session/stream', baseUrl);
    const req = http.request(url, { method: 'GET' }, (res) => {
      assert.equal(res.statusCode, 200);
      let buf = '';
      /** @type {{ name: string, data: any }[]} */
      const collected = [];
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`SSE timeout; got ${collected.length} frames`));
      }, timeoutMs);
      res.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          const sep = buf.indexOf('\n\n');
          if (sep < 0) break;
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          if (frame.startsWith(':')) continue;
          let name = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim();
            if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            collected.push({ name, data: JSON.parse(data) });
          } catch {
            collected.push({ name, data });
          }
          const livePatches = collected.filter(
            (e) =>
              e.name === 'patch' &&
              Array.isArray(e.data?.state?.liveSubAgentRuns) &&
              e.data.state.liveSubAgentRuns.length > 0,
          );
          if (livePatches.length >= minPatches) {
            clearTimeout(timer);
            req.destroy();
            resolve({ collected, livePatches });
          }
        }
      });
      res.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('session engine phase 3 controller (MIN-361)', () => {
  /** @type {string | undefined} */
  let home;
  /** @type {http.Server | undefined} */
  let server;
  /** @type {string | undefined} */
  let baseUrl;
  /** @type {string | undefined} */
  let prevEngineFlag;

  before(async () => {
    home = setTestHome(process.env, 'minnow-session-phase3');
    defaultSessionFixture = JSON.parse(await readFixture('expected-sessions-state.json'));
    prevEngineFlag = process.env.MINNOW_SERVER_ENGINE;
    process.env.MINNOW_SERVER_ENGINE = '1';
    resetSessionRevStoreForTests();
    resetSessionSseForTests();
    resetBoardDriverLeaseForTests();
    resetSessionEngineForTests();
    resetBoardLoaderForTests();
    resetControllerLoaderForTests();
    server = createPhase3TestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    resetBoardDriverLeaseForTests();
    resetBoardLoaderForTests();
    resetControllerLoaderForTests();
    resetEngineControllerHostBootForTests();
    setEngineOwnsController(false);
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 250 }));
    setSubAgentRunIdFactory(() => 'run-phase3-fixed-001');
    process.env.MINNOW_SERVER_ENGINE = '1';
  });

  after(async () => {
    try {
      await deactivateEngineControllerHost();
    } catch {
      /* host may not have loaded */
    }
    setEngineOwnsController(false);
    resetSessionSseForTests();
    resetBoardDriverLeaseForTests();
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    resetBoardLoaderForTests();
    resetControllerLoaderForTests();
    if (prevEngineFlag === undefined) delete process.env.MINNOW_SERVER_ENGINE;
    else process.env.MINNOW_SERVER_ENGINE = prevEngineFlag;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    closeSessionsDb();
    if (home) rmTestHome(home);
  });

  test('spawn_sub_agent command publishes liveSubAgentRuns on engine state', async () => {
    const state = structuredClone(defaultSessionFixture);
    const chatId = state.chats[0].id;
    await httpRequest(baseUrl, 'PUT', '/api/config/sessions', state);
    await ensureSessionEngineBooted();

    const { bootEngineControllerOnStart } = await import(
      '../../server/session/controller-loader.js'
    );
    await bootEngineControllerOnStart();

    const spawn = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'spawn_sub_agent',
      agentType: 'explore',
      task: 'phase3 live status',
      wait: false,
      parentChatId: chatId,
    });
    assert.equal(spawn.status, 202, JSON.stringify(spawn.json));
    assert.equal(spawn.json.accepted, true);

    await flushLiveSubAgentPublishForTests();

    const engineState = getEngineSessionState();
    assert.ok(Array.isArray(engineState.liveSubAgentRuns));
    assert.ok(
      engineState.liveSubAgentRuns.some(
        (r) => r.runId === 'run-phase3-fixed-001' && r.status === 'running',
      ),
      JSON.stringify(engineState.liveSubAgentRuns),
    );
  });

  test('two SSE subscribers see the same liveSubAgentRuns slice', async () => {
    const state = structuredClone(defaultSessionFixture);
    const chatId = state.chats[0].id;
    await commitEngineState(structuredClone(state));
    await ensureSessionEngineBooted();

    const { bootEngineControllerOnStart } = await import(
      '../../server/session/controller-loader.js'
    );
    await bootEngineControllerOnStart();

    const subA = collectLiveRunPatches(baseUrl, { minPatches: 1 });
    const subB = collectLiveRunPatches(baseUrl, { minPatches: 1 });
    // Let both streams open before spawning.
    await new Promise((r) => setTimeout(r, 80));

    const spawn = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'spawn_sub_agent',
      agentType: 'explore',
      task: 'multi-client visibility',
      wait: false,
      parentChatId: chatId,
    });
    assert.equal(spawn.status, 202, JSON.stringify(spawn.json));
    await flushLiveSubAgentPublishForTests();

    const [a, b] = await Promise.all([subA, subB]);
    const runsA = a.livePatches[0].data.state.liveSubAgentRuns;
    const runsB = b.livePatches[0].data.state.liveSubAgentRuns;
    assert.ok(runsA.some((r) => r.runId === 'run-phase3-fixed-001'));
    assert.ok(runsB.some((r) => r.runId === 'run-phase3-fixed-001'));
    assert.equal(
      runsA.find((r) => r.runId === 'run-phase3-fixed-001').task,
      runsB.find((r) => r.runId === 'run-phase3-fixed-001').task,
    );
  });

  test('cancel_sub_agent command settles an engine-hosted run', async () => {
    const state = structuredClone(defaultSessionFixture);
    const chatId = state.chats[0].id;
    await httpRequest(baseUrl, 'PUT', '/api/config/sessions', state);
    await ensureSessionEngineBooted();

    const { bootEngineControllerOnStart } = await import(
      '../../server/session/controller-loader.js'
    );
    await bootEngineControllerOnStart();

    setSubAgentRunnerFactory(() => createMockSubAgentRunner({ delayMs: 5_000 }));

    const spawn = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'spawn_sub_agent',
      agentType: 'explore',
      task: 'cancel me',
      wait: false,
      parentChatId: chatId,
    });
    assert.equal(spawn.status, 202, JSON.stringify(spawn.json));

    const cancel = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'cancel_sub_agent',
      runId: 'run-phase3-fixed-001',
      reason: 'user_cancel',
    });
    assert.equal(cancel.status, 202, JSON.stringify(cancel.json));
    assert.equal(cancel.json.accepted, true);

    await flushLiveSubAgentPublishForTests();
    const engineState = getEngineSessionState();
    const row = (engineState.liveSubAgentRuns ?? []).find(
      (r) => r.runId === 'run-phase3-fixed-001',
    );
    // May already be evicted from live slice; registry settle is the acceptance signal.
    if (row) {
      assert.equal(row.status, 'cancelled');
    }
    const detail = cancel.json.detail ? JSON.parse(cancel.json.detail) : null;
    assert.equal(detail?.status, 'cancelled');
  });

  test('flag off: controller commands return 503', async () => {
    process.env.MINNOW_SERVER_ENGINE = '0';
    resetSessionEngineForTests();
    const res = await httpRequestWithHeaders(baseUrl, 'POST', '/api/session/commands', {
      type: 'cancel_sub_agent',
      runId: 'x',
    });
    assert.equal(res.status, 503);
    process.env.MINNOW_SERVER_ENGINE = '1';
  });
});
