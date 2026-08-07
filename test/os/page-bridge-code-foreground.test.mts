import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
  shouldHideAppBody,
} from '../../src/os/page-bridge.ts';
import { initOsRouter, resetOsRouterForTests } from '../../src/os/router.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="appBody"></div>
    <div id="osStage">
      <div id="osAppsLayer"></div>
    </div>
    <input type="file" id="fileInput" />
  `;
}

describe('page-bridge code foreground', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      localStorage: Storage;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.localStorage = win.localStorage;
    setupDom(win);
    win.location.hash = '#/app/code/chat';
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    initOsRouter();
    initOsPageBridge();
  });

  afterEach(() => {
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('keeps #appBody visible when Code is the foreground app', () => {
    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
  });
});
