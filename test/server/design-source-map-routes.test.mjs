/**
 * Element → source mapping route + matcher (MIN-369). Mirrors
 * test/server/design-annotations-middleware.test.mjs's HTTP harness. The matcher
 * (findElementLineInSource) is also exercised directly for the unique-vs-ambiguous → exact/
 * probable distinction the route depends on.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { request as httpRequestNode } from 'node:http';
import { handleSourceMapRequest } from '../../server/design/source-map-routes.js';
import { findElementLineInSource } from '../../server/design/source-map-match.js';
import { isResolvedPathUnderRoot } from '../../server/workspace/safe-path.js';

function httpRequest(baseUrl, method, pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const r = httpRequestNode(url, { method }, (res) => {
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
        resolve({ status: res.statusCode, body: raw, json });
      });
    });
    r.on('error', reject);
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

async function startSourceMapServer(workspaceRoot) {
  const deps = {
    resolveSafePath: makeResolveSafePath(workspaceRoot),
    runWithPathAccess: (fn) => fn(),
  };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const handled = await handleSourceMapRequest(req, res, pathname, deps);
    if (!handled) {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('findElementLineInSource (matcher)', () => {
  test('a unique id match is exact', () => {
    const html = ['<div>', '<button id="buy-now" class="cta">Buy</button>', '</div>'].join('\n');
    const match = findElementLineInSource(html, { id: 'buy-now' });
    assert.deepEqual(match, { line: 2, confidence: 'exact', matchedBy: 'id' });
  });

  test('an id repeated on multiple lines is probable (first match wins)', () => {
    const html = ['<button id="dupe">A</button>', '<button id="dupe">B</button>'].join('\n');
    const match = findElementLineInSource(html, { id: 'dupe' });
    assert.deepEqual(match, { line: 1, confidence: 'probable', matchedBy: 'id' });
  });

  test('falls back to a distinctive class combo scoped to the tag when there is no id', () => {
    const html = ['<div class="cta">not it</div>', '<button class="cta primary">Buy</button>'].join('\n');
    const match = findElementLineInSource(html, { tag: 'button', classCombo: 'cta primary' });
    assert.deepEqual(match, { line: 2, confidence: 'exact', matchedBy: 'class' });
  });

  test('falls back to a normalized outerHTML slice when id and class both miss', () => {
    const html = ['<section>', '  <span>Totally unique marker text here</span>', '</section>'].join('\n');
    const match = findElementLineInSource(html, { htmlSnippet: 'Totally unique marker text here' });
    assert.deepEqual(match, { line: 2, confidence: 'exact', matchedBy: 'html' });
  });

  test('no signal hits anything returns null', () => {
    const html = '<div>hello</div>';
    const match = findElementLineInSource(html, { id: 'nope', classCombo: 'also-nope' });
    assert.equal(match, null);
  });

  test('a short/generic htmlSnippet (< 8 normalized chars) is never used as a signal', () => {
    const html = '<div>ok</div>\n<div>ok</div>';
    const match = findElementLineInSource(html, { htmlSnippet: 'ok' });
    assert.equal(match, null);
  });
});

describe('GET /api/design/source-map', () => {
  let workspaceDir;
  let server;
  let baseUrl;

  before(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-source-map-'));
    await fs.writeFile(
      path.join(workspaceDir, 'pricing.html'),
      [
        '<!doctype html>',
        '<html><body>',
        '<div class="hero">',
        '<button id="buy-now" class="cta primary">Buy now</button>',
        '</div>',
        '</body></html>',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(workspaceDir, 'checkout.html'),
      ['<button class="cta">A</button>', '<button class="cta">B</button>'].join('\n'),
      'utf8',
    );
    ({ server, baseUrl } = await startSourceMapServer(workspaceDir));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('unique id match on a static page returns exact file:line', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/source-map?page=${encodeURIComponent('pricing.html')}&tag=button&id=${encodeURIComponent('buy-now')}&classes=${encodeURIComponent('cta primary')}`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { file: 'pricing.html', line: 4, confidence: 'exact' });
  });

  test('an ambiguous class combo on a static page returns probable', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/source-map?page=${encodeURIComponent('checkout.html')}&tag=button&classes=${encodeURIComponent('cta')}`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { file: 'checkout.html', line: 1, confidence: 'probable' });
  });

  test('no page returns a guess without erroring', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/design/source-map');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { confidence: 'guess' });
  });

  test('a non-HTML page returns a guess (dev-server pages are resolved client-side)', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/source-map?page=${encodeURIComponent('src/App.tsx')}`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { confidence: 'guess' });
  });

  test('an unknown page returns a guess instead of a 404/500', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/source-map?page=${encodeURIComponent('missing.html')}&id=x`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { confidence: 'guess' });
  });

  test('a page path outside the workspace returns a guess, not the file contents', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/source-map?page=${encodeURIComponent('../outside.html')}`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { confidence: 'guess' });
  });

  test('an id/class signal that matches nothing on the page returns a guess', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      `/api/design/source-map?page=${encodeURIComponent('pricing.html')}&id=nonexistent`,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { file: 'pricing.html', confidence: 'guess' });
  });

  test('unsupported method returns 405', async () => {
    const res = await httpRequest(baseUrl, 'POST', '/api/design/source-map');
    assert.equal(res.status, 405);
  });
});
