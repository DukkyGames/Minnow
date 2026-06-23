/**
 * POST /api/orchestrate/board-log — JSONL mirror under ~/.minnow/logs/orchestrate/.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { handleOrchestrateRequest } from '../../server/orchestrate/middleware.js';
import { httpRequest, rmTestHome, setTestHome } from '../config/test-helpers.js';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';

function createOrchestrateTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleOrchestrateRequest(req, res, url.pathname).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
}

describe('orchestrate board-log API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env);
    server = createOrchestrateTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
    resetMinnowHomeCache();
  });

  test('appends one JSON line per event', async () => {
    const event = {
      id: '1710000001000-0',
      ts: 1710000001000,
      type: 'task_status',
      level: 'info',
      taskId: 'W1-A',
      message: 'W1-A: planned → in_progress',
      detail: { from: 'planned', to: 'in_progress' },
    };
    const res = await httpRequest(baseUrl, 'POST', '/api/orchestrate/board-log', {
      groupId: GROUP_ID,
      event,
    });
    assert.equal(res.status, 204);

    const logPath = path.join(homeDir, 'logs', 'orchestrate', `${GROUP_ID}.jsonl`);
    const text = await fs.readFile(logPath, 'utf8');
    assert.equal(text.trimEnd(), JSON.stringify(event));
  });

  test('rejects missing groupId or event', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/orchestrate/board-log', {
      groupId: GROUP_ID,
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error ?? ''), /groupId and event required/);
  });
});
