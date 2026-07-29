import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { resetAppHostForTests, initAppHost } from '../../src/os/app-host.ts';
import { resetAppModulesForTests } from '../../src/os/app-modules.ts';
import { getInstanceSnapshot, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  initOsRouter,
  launchApp,
  resetOsRouterForTests,
} from '../../src/os/router.ts';
import {
  dismissAllMemorySavedToasts,
  showMemorySavedToast,
} from '../../src/ui/memory-saved-toast.ts';
import { resetBrainPageForTests } from '../../src/ui/brain-page.ts';
import {
  resetWindowManagerForTests,
  windowManager,
} from '../../src/os/window-manager.ts';
import { installHappyDomGlobals, teardownHappyDomAsync } from './dom-helpers.mts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="osStage" style="width:1200px;height:800px;position:relative">
      <div id="osAppsLayer"></div>
      <div id="osWindowsLayer"></div>
    </div>
    <div id="appBody"></div>
    <main id="brainView" data-os-app="brain">
      <h1 id="brainPageHeaderTitle"></h1>
      <p id="brainPageHeaderLead"></p>
      <div id="brainPageHeaderActions"></div>
      <button id="btnBrainPageBack"></button>
      <button data-brain-nav="graph"></button>
      <button data-brain-nav="edit"></button>
      <section id="brainSection-graph"></section>
      <section id="brainSection-edit">
        <input id="brainEditPath">
        <input id="brainEditTitle">
        <input id="brainEditTags">
        <textarea id="brainEditBody"></textarea>
        <div id="brainEditPreview"></div>
        <div id="brainEditStatus"></div>
      </section>
    </main>
  `;
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  const { Window } = await import('happy-dom');
  const win = new Window();
  installHappyDomGlobals(win, {
    fetch: async () => new Response(null, { status: 503 }),
  });
  setupDom(win);
  win.location.hash = '#/desktop';
  resetWindowManagerForTests();
  resetInstancesForTests();
  resetOsRouterForTests();
  resetAppModulesForTests();
  resetAppHostForTests();
  resetBrainPageForTests();
  initAppHost();
  initOsRouter();
});

afterEach(async () => {
  dismissAllMemorySavedToasts();
  resetWindowManagerForTests();
  resetInstancesForTests();
  resetOsRouterForTests();
  resetAppModulesForTests();
  resetAppHostForTests();
  await teardownHappyDomAsync(window as unknown as import('happy-dom').Window);
});

test('Open memory navigates an already-mounted Brain Graph window to populated Edit', async () => {
  launchApp('brain', { brainSection: 'edit' });
  await waitFor(
    () => Boolean(document.querySelector('#brainSection-edit')?.classList.contains('is-active')),
    'Brain Edit did not become active',
  );

  showMemorySavedToast({
    title: 'Open action demo',
    description: 'Live window navigation fixture.',
    target: { kind: 'page', relPath: 'facts/open-action-demo.md' },
  });

  document.querySelector<HTMLButtonElement>('[data-brain-nav="graph"]')?.click();
  await waitFor(
    () => Boolean(document.querySelector('#brainSection-graph')?.classList.contains('is-active')),
    'Brain Graph did not become active',
  );

  const brainWindow = windowManager.getWindows().find((win) => win.appId === 'brain');
  assert.ok(brainWindow);
  assert.equal(
    document.querySelector('#brainSection-graph')?.classList.contains('is-active'),
    true,
  );

  document.querySelector<HTMLButtonElement>('.memory-saved-toast__button--open')?.click();
  await waitFor(
    () => {
      const instance = getInstanceSnapshot().instances.find((item) => item.appId === 'brain');
      return (
        window.location.hash === '#/app/brain/edit' &&
        instance?.launchOptions?.brainEditPath === 'facts/open-action-demo.md' &&
        Boolean(document.querySelector('#brainSection-edit')?.classList.contains('is-active'))
      );
    },
    'Open memory did not route the Brain window to the saved page',
  );

  assert.equal(window.location.hash, '#/app/brain/edit');
  const brainInstance = getInstanceSnapshot().instances.find((instance) => instance.appId === 'brain');
  assert.equal(brainInstance?.launchOptions?.brainSection, 'edit');
  assert.equal(
    (brainInstance?.launchOptions as Record<string, unknown> | undefined)?.brainEditPath,
    'facts/open-action-demo.md',
  );
  assert.equal(
    document.querySelector('#brainSection-edit')?.classList.contains('is-active'),
    true,
  );
  assert.equal(
    (document.getElementById('brainEditPath') as HTMLInputElement | null)?.value,
    'facts/open-action-demo.md',
  );
  assert.equal(document.getElementById('brainPageHeaderTitle')?.textContent, 'Edit');
  assert.equal(
    document.querySelector('#brainSection-graph')?.classList.contains('is-active'),
    false,
  );

  await new Promise((resolve) => setTimeout(resolve, 4_000));

  assert.equal(window.location.hash, '#/app/brain/edit');
  assert.equal(document.getElementById('brainPageHeaderTitle')?.textContent, 'Edit');
  assert.equal(
    document.querySelector('#brainSection-edit')?.classList.contains('is-active'),
    true,
  );
  assert.equal(
    document.querySelector('#brainSection-graph')?.classList.contains('is-active'),
    false,
  );
});
