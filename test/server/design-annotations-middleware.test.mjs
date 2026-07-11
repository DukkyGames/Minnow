/**
 * Draw & Comment tool persistence route (MIN-367) — GET/PUT /api/design/annotations,
 * scoped to the workspace via resolveSafePath. Mirrors test/server/preview-middleware.test.mjs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { request as httpRequestNode } from 'node:http';
import { handleDesignAnnotationsRequest } from '../../server/design/annotations-routes.js';
import { isResolvedPathUnderRoot } from '../../server/workspace/safe-path.js';

function httpRequest(baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const r = httpRequestNode(
      url,
      {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { raw };
          }
          resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
        });
      },
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function makeResolveSafePath(workspaceRoot) {
  return (userPath, options = {}) => {
    void options;
    const resolved = path.isAbsolute(userPath)
      ? path.resolve(userPath)
      : path.resolve(workspaceRoot, userPath);
    if (!isResolvedPathUnderRoot(resolved, workspaceRoot)) {
      throw new Error('outside workspace');
    }
    return resolved;
  };
}

async function startAnnotationsServer(workspaceRoot) {
  const deps = {
    resolveSafePath: makeResolveSafePath(workspaceRoot),
    runWithPathAccess: (fn) => fn(),
  };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const handled = await handleDesignAnnotationsRequest(req, res, pathname, deps);
    if (!handled) {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('design annotations middleware', () => {
  let workspaceDir;
  let server;
  let baseUrl;

  before(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-design-annotations-'));
    ({ server, baseUrl } = await startAnnotationsServer(workspaceDir));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  beforeEach(async () => {
    await fs.rm(path.join(workspaceDir, '.minnow'), { recursive: true, force: true });
  });

  test('GET without a page returns 400', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/design/annotations');
    assert.equal(res.status, 400);
    assert.match(res.json.error, /page is required/);
  });

  test('GET for an unknown page returns an empty shapes/pins document', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/annotations?page=${encodeURIComponent('pricing.html')}`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { shapes: [], pins: [] });
  });

  test('PUT persists a page and GET returns exactly what was written', async () => {
    const shape = {
      id: 's1',
      kind: 'rect',
      rect: { x: 1, y: 2, width: 10, height: 20 },
      anchor: { type: 'page', x: 1, y: 2, scrollX: 0, scrollY: 0 },
      createdAt: 1700000000000,
    };
    const putRes = await httpRequest(baseUrl, 'PUT', '/api/design/annotations', {
      page: 'pricing.html',
      annotations: { shapes: [shape], pins: [] },
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.json.ok, true);

    const getRes = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/annotations?page=${encodeURIComponent('pricing.html')}`,
    );
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.json, { shapes: [shape], pins: [] });
  });

  test('the JSON file lands under .minnow/design/annotations.json inside the workspace', async () => {
    await httpRequest(baseUrl, 'PUT', '/api/design/annotations', {
      page: 'checkout.html',
      annotations: { shapes: [], pins: [] },
    });
    const onDisk = await fs.readFile(
      path.join(workspaceDir, '.minnow', 'design', 'annotations.json'),
      'utf8',
    );
    const parsed = JSON.parse(onDisk);
    assert.ok(parsed.pages['checkout.html']);
  });

  test('different pages are stored independently under the same file', async () => {
    await httpRequest(baseUrl, 'PUT', '/api/design/annotations', {
      page: 'a.html',
      annotations: { shapes: [], pins: [{ id: 'p1', index: 1, x: 0, y: 0, anchor: { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 }, notes: [] }] },
    });
    await httpRequest(baseUrl, 'PUT', '/api/design/annotations', {
      page: 'b.html',
      annotations: { shapes: [], pins: [] },
    });

    const resA = await httpRequest(baseUrl, 'GET', `/api/design/annotations?page=${encodeURIComponent('a.html')}`);
    const resB = await httpRequest(baseUrl, 'GET', `/api/design/annotations?page=${encodeURIComponent('b.html')}`);
    assert.equal(resA.json.pins.length, 1);
    assert.equal(resB.json.pins.length, 0);
  });

  test('PUT without a page returns 400', async () => {
    const res = await httpRequest(baseUrl, 'PUT', '/api/design/annotations', {
      annotations: { shapes: [], pins: [] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /page is required/);
  });

  test('unsupported method returns 405', async () => {
    const res = await httpRequest(baseUrl, 'DELETE', '/api/design/annotations');
    assert.equal(res.status, 405);
  });
});
