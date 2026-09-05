import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.MINNOW_TEST = '1';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-home-'));
process.env.MINNOW_HOME = home;

const { createWorkspaceScopeMiddleware } = await import(
  '../../server/runtime/workspace-scope-middleware.js'
);
const { getEffectiveWorkspaceRoot, getRequestWorkspaceRoot, runWithToolContext } =
  await import('../../server/runtime/path-access.js');
const { closeWorkspace, openWorkspace, resetOpenWorkspaces } = await import(
  '../../server/workspace/open-workspaces.js'
);
const { initWorkspaceRoot, setWorkspaceRoot } = await import(
  '../../server/workspace/root.js'
);

const middleware = createWorkspaceScopeMiddleware();

/** Drive the middleware the way connect does and report what `next()` saw. */
function runRequest({ url = '/api/anything', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = { url, headers, method: 'GET' };
    let statusCode = 200;
    let body = '';
    const res = {
      set statusCode(value) {
        statusCode = value;
      },
      get statusCode() {
        return statusCode;
      },
      setHeader() {},
      end(text) {
        resolve({ nexted: false, status: statusCode, body: text ?? body });
      },
    };
    middleware(req, res, () => {
      resolve({
        nexted: true,
        status: statusCode,
        effective: getEffectiveWorkspaceRoot(),
        request: getRequestWorkspaceRoot(),
        stamped: req.minnowWorkspaceRoot,
      });
    });
  });
}

let root;
let repoA;
let repoB;
let stranger;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-'));
  repoA = path.join(root, 'repo-a');
  repoB = path.join(root, 'repo-b');
  stranger = path.join(root, 'stranger');
  for (const dir of [repoA, repoB, stranger]) {
    await fs.mkdir(dir, { recursive: true });
  }
  await initWorkspaceRoot();
  await setWorkspaceRoot(repoA);
});

after(async () => {
  resetOpenWorkspaces();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  resetOpenWorkspaces();
});

describe('workspace scope middleware', () => {
  test('a request with no workspace falls through to the persisted global', async () => {
    const result = await runRequest();
    assert.equal(result.nexted, true);
    assert.equal(result.stamped, undefined);
    assert.equal(path.resolve(result.effective), path.resolve(repoA));
  });

  test('scopes on the X-Minnow-Workspace header', async () => {
    openWorkspace(repoB);
    const result = await runRequest({ headers: { 'x-minnow-workspace': repoB } });
    assert.equal(result.nexted, true);
    assert.equal(path.resolve(result.effective), path.resolve(repoB));
    assert.equal(path.resolve(result.stamped), path.resolve(repoB));
    closeWorkspace(repoB);
  });

  test('scopes on ?workspace= — SSE and WebSocket cannot set headers', async () => {
    openWorkspace(repoB);
    const result = await runRequest({
      url: `/api/generations/stream?token=abc&workspace=${encodeURIComponent(repoB)}`,
    });
    assert.equal(result.nexted, true);
    assert.equal(path.resolve(result.effective), path.resolve(repoB));
    closeWorkspace(repoB);
  });

  test('rejects a workspace nothing has open', async () => {
    const result = await runRequest({ headers: { 'x-minnow-workspace': stranger } });
    assert.equal(result.nexted, false);
    assert.equal(result.status, 400);
    assert.match(result.body, /Unknown workspace/);
  });

  test('leaves non-API requests entirely alone', async () => {
    const result = await runRequest({
      url: '/index.html',
      headers: { 'x-minnow-workspace': stranger },
    });
    assert.equal(result.nexted, true);
    assert.equal(result.stamped, undefined);
  });

  test('an explicit per-call override wins over the view, but not for the allowlist', async () => {
    openWorkspace(repoB);
    const result = await new Promise((resolve) => {
      const req = { url: '/api/tools', headers: { 'x-minnow-workspace': repoB }, method: 'POST' };
      const res = { setHeader() {}, end() {} };
      middleware(req, res, () => {
        // A worktree/sandbox override layered on top of the view scope.
        void runWithToolContext(
          async () => {
            resolve({
              effective: getEffectiveWorkspaceRoot(),
              request: getRequestWorkspaceRoot(),
            });
          },
          { workspaceRoot: stranger },
        );
      });
    });
    assert.equal(path.resolve(result.effective), path.resolve(stranger));
    // The view's workspace survives underneath, so an override can never
    // authorise itself.
    assert.equal(path.resolve(result.request), path.resolve(repoB));
    closeWorkspace(repoB);
  });
});
