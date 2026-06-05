import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  getCurrentRoute,
  initOsRouter,
  launchApp,
  navigateToDesktop,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
  syncOsRouteFromHashForTests,
} from '../../src/os/router.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';

describe('resolveLegacyHash', () => {
  test('redirects settings paths to the settings app', () => {
    assert.deepEqual(resolveLegacyHash('#/settings/providers'), {
      hash: '#/app/settings',
      settingsSection: 'providers',
    });
    assert.deepEqual(resolveLegacyHash('#/settings'), {
      hash: '#/app/settings',
      settingsSection: 'general',
    });
  });

  test('redirects legacy full-page routes to OS apps', () => {
    assert.deepEqual(resolveLegacyHash('#/benchmark'), { hash: '#/app/bench' });
    assert.deepEqual(resolveLegacyHash('#/research/run'), { hash: '#/app/research' });
    assert.deepEqual(resolveLegacyHash('#/experts/gallery'), { hash: '#/app/experts' });
  });
});

describe('parseOsHash', () => {
  test('parses desktop and app routes', () => {
    assert.deepEqual(parseOsHash('#/'), { view: 'desktop' });
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'desktop' });
    assert.deepEqual(parseOsHash('#/app/code'), { view: 'app', appId: 'code' });
    assert.deepEqual(parseOsHash('#/app/chat'), { view: 'app', appId: 'chat' });
  });

  test('falls back to desktop for unknown app ids', () => {
    assert.deepEqual(parseOsHash('#/app/unknown'), { view: 'desktop' });
  });
});

describe('os router navigation', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    win.document.body.innerHTML = `
      <header class="topbar"></header>
      <div id="appBody"></div>
    `;
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    initOsRouter();
  });

  afterEach(() => {
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('getCurrentRoute reflects desktop hash', () => {
    window.location.hash = '#/desktop';
    syncOsRouteFromHashForTests();
    assert.deepEqual(getCurrentRoute(), { view: 'desktop' });
  });

  test('launchApp updates hash and foreground instance', () => {
    launchApp('code');
    assert.equal(window.location.hash, '#/app/code');
    syncOsRouteFromHashForTests();
    const route = getCurrentRoute();
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'code');
  });

  test('navigateToDesktop returns to desktop view', () => {
    launchApp('chat');
    syncOsRouteFromHashForTests();
    navigateToDesktop();
    assert.equal(window.location.hash, '#/desktop');
    syncOsRouteFromHashForTests();
    assert.deepEqual(getCurrentRoute(), { view: 'desktop' });
  });

  test('legacy settings hash resolves to settings app route', () => {
    window.location.hash = '#/settings/modes';
    const route = getCurrentRoute();
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'settings');
    assert.equal(route.settingsSection, 'modes');
  });

  test('applyRouteFromHash redirects legacy settings hash', () => {
    window.location.hash = '#/settings/modes';
    syncOsRouteFromHashForTests();
    assert.equal(window.location.hash, '#/app/settings');
    syncOsRouteFromHashForTests();
    assert.equal(getCurrentRoute().settingsSection, 'modes');
  });
});
