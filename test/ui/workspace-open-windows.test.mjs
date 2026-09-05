import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

/** @type {import('happy-dom').Window | undefined} */
let win;

/** Recents fixture: one current folder plus two the user could act on. */
function setupDom() {
  win = new Window();
  installHappyDomGlobals(win);
  document.body.innerHTML =
    '<span id="sDot" class="s-dot"></span><span id="sText"></span>';
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/workspace')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: '/projects/current',
          label: 'current',
          isDefault: false,
          recent: [
            { path: '/projects/current', label: 'current', exists: true, isCurrent: true },
            { path: '/projects/open', label: 'open', exists: true, isCurrent: false },
            { path: '/projects/idle', label: 'idle', exists: true, isCurrent: false },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

/** Stand in for the Electron preload bridge. */
function installMinnowWindowApi(overrides = {}) {
  const closed = [];
  globalThis.window.minnow = {
    window: {
      openWorkspace: async () => ({ ok: true, focused: true }),
      closeWorkspace: async (path) => {
        closed.push(path);
        return { ok: true, closed: true };
      },
      ...overrides,
    },
  };
  return closed;
}

const {
  canCloseWorkspaceWindows,
  closeOpenWorkspace,
  readOpenWorkspaceWindows,
} = await import('../../src/lib/open-workspace-windows.ts');

const {
  closeWorkspaceMenu,
  renderWorkspaceMenuForTest,
  resetWorkspaceMenuForTests,
  setWorkspaceMenuDeps,
} = await import('../../src/ui/workspace-recent-menu.ts');

setWorkspaceMenuDeps({ isServerAvailable: () => true, reportStatus: () => {} });

describe('open-workspace-windows', { concurrency: false }, () => {
  afterEach(async () => {
    resetWorkspaceMenuForTests();
    closeWorkspaceMenu();
    if (win) {
      delete globalThis.window.minnow;
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('reads window ids and background state, dropping gate windows', async () => {
    setupDom();
    installMinnowWindowApi({
      listWorkspaceWindows: async () => [
        { windowId: 1, workspacePath: '/projects/open', visible: true },
        { windowId: 2, workspacePath: '/projects/idle', visible: false },
        { windowId: 3, workspacePath: '', visible: true },
      ],
    });

    const open = await readOpenWorkspaceWindows();
    assert.equal(open.size, 2);
    assert.equal(open.get('/projects/open')?.visible, true);
    assert.equal(open.get('/projects/idle')?.visible, false);
  });

  test('falls back to the older listWorkspaces bridge', async () => {
    setupDom();
    installMinnowWindowApi({ listWorkspaces: async () => ['/projects/open'] });

    const open = await readOpenWorkspaceWindows();
    assert.equal(open.size, 1);
    // The old bridge cannot report backgrounding, so nothing claims it does.
    assert.equal(open.get('/projects/open')?.visible, true);
  });

  test('reports an empty set outside Electron instead of throwing', async () => {
    setupDom();
    const open = await readOpenWorkspaceWindows();
    assert.equal(open.size, 0);
    assert.equal(canCloseWorkspaceWindows(), false);
    const result = await closeOpenWorkspace('/projects/open');
    assert.equal(result.ok, false);
  });

  test('a bridge that rejects is read as nothing open', async () => {
    setupDom();
    installMinnowWindowApi({
      listWorkspaceWindows: async () => {
        throw new Error('shell is tearing down');
      },
    });
    assert.equal((await readOpenWorkspaceWindows()).size, 0);
  });
});

describe('workspace menu open rows', { concurrency: false }, () => {
  afterEach(async () => {
    resetWorkspaceMenuForTests();
    closeWorkspaceMenu();
    if (win) {
      delete globalThis.window.minnow;
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('badges an open folder and closes it from the row', async () => {
    setupDom();
    const closed = installMinnowWindowApi({
      listWorkspaceWindows: async () => [
        { windowId: 1, workspacePath: '/projects/open', visible: true },
      ],
    });

    const menu = document.createElement('ul');
    await renderWorkspaceMenuForTest(menu);

    const rows = [...menu.querySelectorAll('.workspace-menu__item')];
    const openRow = rows.find((row) => row.dataset.openInWindow === 'true');
    assert.ok(openRow, 'the open folder should be marked');
    assert.equal(openRow.querySelector('.workspace-menu__open-badge')?.textContent, 'Open');

    const idleRow = rows.find((row) => row.textContent?.includes('/projects/idle'));
    assert.equal(idleRow?.dataset.openInWindow, undefined);
    assert.equal(idleRow?.querySelector('.workspace-menu__close-workspace'), null);

    openRow.querySelector('.workspace-menu__close-workspace').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(closed, ['/projects/open']);
  });

  test('a backgrounded window says so rather than reading as plainly open', async () => {
    setupDom();
    installMinnowWindowApi({
      listWorkspaceWindows: async () => [
        { windowId: 2, workspacePath: '/projects/idle', visible: false },
      ],
    });

    const menu = document.createElement('ul');
    await renderWorkspaceMenuForTest(menu);

    const row = menu.querySelector('[data-workspace-backgrounded="true"]');
    assert.ok(row);
    assert.equal(row.querySelector('.workspace-menu__open-badge')?.textContent, 'Background');
  });

  test('never offers to close the window you are in', async () => {
    setupDom();
    installMinnowWindowApi({
      listWorkspaceWindows: async () => [
        { windowId: 1, workspacePath: '/projects/current', visible: true },
      ],
    });

    const menu = document.createElement('ul');
    await renderWorkspaceMenuForTest(menu);

    const current = menu.querySelector('[aria-current="true"]');
    assert.ok(current);
    assert.equal(current.querySelector('.workspace-menu__close-workspace'), null);
  });
});
