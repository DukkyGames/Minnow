/**
 * Eval middleware CRUD with MINNOW_HOME temp dir.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEvalsMiddleware } from '../../server/evals/middleware.js';
import { resetMinnowHomeCache } from '../../server/config/home.js';

let tmpHome = '';
let middleware;

function mockReq(method, url, body) {
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
  return {
    method,
    url,
    on(event, handler) {
      if (event === 'data') chunks.forEach((c) => handler(c));
      if (event === 'end') handler();
    },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(data) {
      this.body = data ?? '';
    },
  };
  return res;
}

async function invoke(method, url, body) {
  return new Promise((resolve) => {
    const req = mockReq(method, url, body);
    const res = mockRes();
    const originalEnd = res.end.bind(res);
    res.end = (data) => {
      originalEnd(data);
      resolve({ status: res.statusCode, body: res.body });
    };
    void middleware(req, res, () => {
      resolve({ status: 404, body: '{}' });
    });
  });
}

before(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-eval-'));
  process.env.MINNOW_HOME = tmpHome;
  resetMinnowHomeCache();
  middleware = createEvalsMiddleware();
});

after(async () => {
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('evals API', () => {
  it('GET ping returns ok', async () => {
    const { status, body } = await invoke('GET', '/api/evals/ping');
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(body), { ok: true });
  });

  it('GET packs lists builtin coding-smoke', async () => {
    const { status, body } = await invoke('GET', '/api/evals/packs');
    assert.equal(status, 200);
    const data = JSON.parse(body);
    const ids = data.packs.map((p) => p.id);
    assert.ok(ids.includes('coding-smoke'));
  });

  it('PUT user pack and GET by id', async () => {
    const pack = {
      id: 'pack-11111111',
      label: 'API test pack',
      version: 1,
      tasks: [
        {
          id: 'task-aaaa',
          prompt: 'Ping',
          allowedTools: ['get_datetime'],
          deniedTools: [],
          rubricPrompt:
            'Score 100 always. JSON: {"score":number,"pass":boolean,"rationale":string}',
        },
      ],
    };
    const put = await invoke('PUT', '/api/evals/packs/pack-11111111', { pack });
    assert.equal(put.status, 200);
    const get = await invoke('GET', '/api/evals/packs/pack-11111111');
    assert.equal(get.status, 200);
    const data = JSON.parse(get.body);
    assert.equal(data.pack.label, 'API test pack');
  });
});
