/**
 * /api/orchestrate/board-testing — fake model, seed board, log validation.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { handleBoardTestingRequest } from '../../server/orchestrate/board-testing/middleware.js';
import { stopFakeModel } from '../../server/orchestrate/board-testing/fake-model-host.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';
import { httpRequest, rmTestHome, setTestHome } from '../config/test-helpers.js';

const GROUP_ID = 'grp_a0000000-0000-4000-8000-000000000001';
const TEST_BOARD_PLANNER_ID = 'a0000000-0000-4000-8000-000000000001';

function createBoardTestingTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleBoardTestingRequest(req, res, url.pathname).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

describe('orchestrate board-testing API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env);
    await fs.mkdir(homeDir, { recursive: true });
    await setWorkspaceRoot(homeDir);
    server = createBoardTestingTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await stopFakeModel();
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
    resetMinnowHomeCache();
  });

  test('GET status reports fake model stopped by default', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/orchestrate/board-testing/status');
    assert.equal(res.status, 200);
    assert.equal(res.json?.fakeModel?.running, false);
    assert.equal(res.json?.seededBoard?.present, false);
    assert.equal(res.json?.seededBoard?.count, 0);
  });

  test('fake model start and stop', async () => {
    const start = await httpRequest(
      baseUrl,
      'POST',
      '/api/orchestrate/board-testing/fake-model/start',
      { port: 0 },
    );
    assert.equal(start.status, 200);
    assert.equal(start.json?.fakeModel?.running, true);
    assert.ok(start.json?.fakeModel?.baseUrl);

    const status = await httpRequest(baseUrl, 'GET', '/api/orchestrate/board-testing/status');
    assert.equal(status.json?.fakeModel?.running, true);
    assert.equal(status.json?.providerRegistered, true);

    const stop = await httpRequest(
      baseUrl,
      'POST',
      '/api/orchestrate/board-testing/fake-model/stop',
    );
    assert.equal(stop.status, 200);
    assert.equal(stop.json?.fakeModel?.running, false);
  });

  test('seed upserts test board sessions', async () => {
    const seed = await httpRequest(baseUrl, 'POST', '/api/orchestrate/board-testing/seed', {
      workspacePath: homeDir,
      preset: 'quick',
      mode: 'manual',
      stableIds: true,
    });
    assert.equal(seed.status, 200);
    assert.equal(seed.json?.groupId, GROUP_ID);
    assert.equal(seed.json?.plannerId, TEST_BOARD_PLANNER_ID);
    assert.equal(seed.json?.taskCount, 3);

    const status = await httpRequest(baseUrl, 'GET', '/api/orchestrate/board-testing/status');
    assert.equal(status.json?.seededBoard?.present, true);
    assert.equal(status.json?.seededBoard?.count, 1);
    assert.equal(status.json?.seededBoard?.stableTestBoardPresent, true);
  });

  test('seed without stable ids creates a new board each time', async () => {
    const first = await httpRequest(baseUrl, 'POST', '/api/orchestrate/board-testing/seed', {
      workspacePath: homeDir,
      preset: 'quick',
      mode: 'manual',
    });
    const second = await httpRequest(baseUrl, 'POST', '/api/orchestrate/board-testing/seed', {
      workspacePath: homeDir,
      preset: 'quick',
      mode: 'manual',
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.notEqual(first.json?.groupId, second.json?.groupId);

    const status = await httpRequest(baseUrl, 'GET', '/api/orchestrate/board-testing/status');
    assert.ok((status.json?.seededBoard?.count ?? 0) >= 2);
  });

  test('check-log validates fixture JSONL', async () => {
    const logDir = path.join(homeDir, 'logs', 'orchestrate');
    await fs.mkdir(logDir, { recursive: true });
    const event = {
      id: '1710000001000-0',
      ts: 1710000001000,
      type: 'board_init',
      level: 'info',
      message: 'board initialized',
      detail: { summary: '1 task' },
    };
    const logPath = path.join(logDir, `${GROUP_ID}.jsonl`);
    await fs.writeFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');

    const res = await httpRequest(baseUrl, 'POST', '/api/orchestrate/board-testing/check-log', {
      groupId: GROUP_ID,
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.json?.ok, 'boolean');
    assert.equal(res.json?.eventsCount, 1);
    assert.ok(Array.isArray(res.json?.skippedInvariants));
  });
});
