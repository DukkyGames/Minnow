import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

function setupWelcomeDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.location = window.location;

  document.body.innerHTML = `
    <header class="topbar"></header>
    <main id="welcomeView" class="welcome-page" hidden></main>
    <div id="appBody" class="app-body"></div>
    <span id="sDot"></span><span id="sText"></span>
    <button type="button" id="btnWelcomeOpenProject"></button>
    <button type="button" id="btnWelcomeCreateProject"></button>
    <section id="welcomeCreatePanel" class="hidden"></section>
    <input id="welcomeProjectName" />
    <code id="welcomeParentPath"></code>
    <button type="button" id="btnWelcomeChangeParent"></button>
    <p id="welcomeCreateError" class="hidden"></p>
    <button type="button" id="btnWelcomeCreateCancel"></button>
    <button type="button" id="btnWelcomeCreateSubmit"></button>
    <ul id="welcomeRecentsList"></ul>
    <p id="welcomeRecentsEmpty" class="hidden"></p>
    <span id="welcomeRecentsCount" hidden></span>
    <p id="welcomeServerBanner" class="hidden"></p>
    <button type="button" id="btnWelcomeContinueMinnow"></button>
  `;

  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.includes('/api/workspace/mkdir') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: `${body.parentPath}/${body.name}`,
          name: body.name,
        }),
      };
    }
    if (path.includes('/api/workspace') && init?.method === 'PUT') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: '/projects/my-app',
          label: 'my-app',
          isDefault: false,
        }),
      };
    }
    if (path.includes('/api/workspace')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: '/minnow/app',
          label: 'app',
          isDefault: true,
          newProjectParent: '/home/user/Projects',
          recent: [
            {
              path: '/projects/old',
              label: 'old',
              exists: true,
              isCurrent: false,
            },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  return window;
}

const {
  closeWelcome,
  isOtherFullPageHash,
  isWelcomePageOpen,
  openWelcome,
  resetWelcomeStateForTests,
  shouldShowWelcomeOnBoot,
  validateProjectFolderName,
} = await import('../../src/ui/welcome-page.ts');

const { resetWorkspaceStateForTests, setWorkspaceFromServer } = await import(
  '../../src/state/workspace.ts'
);

describe('welcome-page', { concurrency: false }, () => {
  test('validateProjectFolderName rejects invalid names', () => {
    assert.equal(validateProjectFolderName(''), 'Enter a project name');
    assert.equal(validateProjectFolderName('bad/name'), 'Name contains invalid characters');
    assert.equal(validateProjectFolderName('con'), 'Invalid project name');
    assert.equal(validateProjectFolderName('valid-name'), null);
  });

  test('isOtherFullPageHash matches settings and bugs routes', () => {
    assert.equal(isOtherFullPageHash('#/settings/general'), true);
    assert.equal(isOtherFullPageHash('#/bugs'), true);
    assert.equal(isOtherFullPageHash('#/benchmark'), true);
    assert.equal(isOtherFullPageHash('#/experts'), true);
    assert.equal(isOtherFullPageHash('#/welcome'), false);
  });

  test('shouldShowWelcomeOnBoot when workspace is default', () => {
    setupWelcomeDom();
    resetWelcomeStateForTests();
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: '/minnow/app',
      label: 'app',
      isDefault: true,
    });
    window.location.hash = '#/';
    assert.equal(shouldShowWelcomeOnBoot(), true);
    window.location.hash = '#/settings/general';
    assert.equal(shouldShowWelcomeOnBoot(), false);
  });

  test('shouldShowWelcomeOnBoot false when workspace is not default', () => {
    setupWelcomeDom();
    resetWelcomeStateForTests();
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: '/projects/app',
      label: 'app',
      isDefault: false,
    });
    window.location.hash = '#/';
    assert.equal(shouldShowWelcomeOnBoot(), false);
  });

  test('openWelcome hides app body and shows welcome view', () => {
    setupWelcomeDom();
    resetWelcomeStateForTests();
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: '/minnow/app',
      label: 'app',
      isDefault: true,
    });

    openWelcome({ skipHash: true });
    assert.equal(isWelcomePageOpen(), true);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), true);
    assert.equal(document.querySelector('header.topbar')?.classList.contains('topbar--welcome'), true);

    closeWelcome({ skipHash: true });
    assert.equal(isWelcomePageOpen(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
  });
});
