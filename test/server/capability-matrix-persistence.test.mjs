/**
 * Capability matrix roster + manual verdict persistence routes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { createBenchmarksMiddleware } from '../../server/benchmarks/middleware.js';
import { httpRequest, rmTestHome, setTestHome } from '../config/test-helpers.js';

process.env.MINNOW_TEST = '1';

function createBenchmarksTestServer() {
  const middleware = createBenchmarksMiddleware();
  return http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });
}

describe('capability matrix benchmark persistence API', () => {
  let homeDir;
  let server;
  let baseUrl;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-cap-matrix-api');
    await fs.mkdir(homeDir, { recursive: true });
    server = createBenchmarksTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rmTestHome(homeDir);
    resetMinnowHomeCache();
  });

  test('roster PUT then GET round-trip', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/benchmarks/capability-matrix/roster', {
      targets: [{ providerId: 'openai', modelId: 'gpt-4', enabled: true }],
    });
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/benchmarks/capability-matrix/roster');
    assert.equal(get.status, 200);
    assert.equal(get.json?.targets?.length, 1);
    assert.equal(get.json.targets[0].modelId, 'gpt-4');
  });

  test('verdict POST upsert then GET', async () => {
    const post = await httpRequest(
      baseUrl,
      'POST',
      '/api/benchmarks/capability-matrix/verdicts',
      {
        targetKey: 'openai::gpt-4',
        capabilityId: 'core-streaming',
        verdict: 'partial',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    );
    assert.equal(post.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/benchmarks/capability-matrix/verdicts');
    assert.equal(get.status, 200);
    const key = 'openai::gpt-4::core-streaming';
    assert.equal(get.json?.verdicts?.[key]?.verdict, 'partial');
  });

  test('import PUT replaces verdict store', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/benchmarks/capability-matrix/import', {
      verdicts: [
        {
          targetKey: 'lm-studio::local',
          capabilityId: 'files-read',
          verdict: 'pass',
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    });
    assert.equal(put.status, 200);

    const get = await httpRequest(baseUrl, 'GET', '/api/benchmarks/capability-matrix/verdicts');
    assert.equal(get.json?.verdicts?.['openai::gpt-4::core-streaming'], undefined);
    assert.equal(get.json?.verdicts?.['lm-studio::local::files-read']?.verdict, 'pass');
  });

  test('campaign POST accepts larger body limit (no 413 for modest payload)', async () => {
    const campaign = {
      id: 'campaign-large-test',
      startedAt: '2026-06-01T00:00:00.000Z',
      endedAt: '2026-06-01T01:00:00.000Z',
      durationMs: 1,
      preset: 'custom',
      targets: [],
      suites: [],
      status: 'completed',
      cells: [],
      aggregates: [],
      runs: [],
      kind: 'capability-matrix',
      padding: 'x'.repeat(3 * 1024 * 1024),
    };
    const post = await httpRequest(baseUrl, 'POST', '/api/benchmarks/campaigns', campaign);
    assert.equal(post.status, 201);

    const filePath = path.join(
      homeDir,
      'benchmarks',
      'campaigns',
      'campaign-large-test.json',
    );
    const raw = await fs.readFile(filePath, 'utf8');
    assert.ok(raw.includes('padding'));
  });
});
