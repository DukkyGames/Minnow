import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  activateDesktopChat,
  activateDesktopExperts,
  activateDesktopResearch,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
  shouldHideAppBody,
} from '../../src/os/page-bridge.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="appBody"></div>
    <div id="osStage">
      <div id="osDesktopLayer">
        <div class="mn-os-composer-dock">
          <div class="mn-os-composer-research-actions">
            <button type="button" id="btnDesktopResearchLibrary">Library</button>
          </div>
          <div id="desktopComposerRoot" class="mn-os-desktop-composer"></div>
        </div>
      </div>
      <div id="osAppsLayer"></div>
    </div>
    <textarea id="desktopInput"></textarea>
    <div class="mn-os-desk-hero">
      <h1 class="mn-os-greet"></h1>
      <p class="mn-os-greet-sub"></p>
      <div class="mn-os-concierge-mount"></div>
    </div>
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
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.localStorage = win.localStorage;
    win.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/config/research')) {
        return {
          ok: true,
          json: async () => ({ model: { providerId: '', model: '' }, maxRounds: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    setupDom(win);
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();
  });

  afterEach(() => {
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('keeps #appBody visible when Code is foreground over desktop chat', async () => {
    await activateDesktopChat();
    assert.equal(shouldHideAppBody(), true);

    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
    assert.equal(document.documentElement.classList.contains('os-desktop-chat'), false);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
  });

  test('keeps #appBody visible when Code is foreground over desktop research', async () => {
    await activateDesktopResearch();
    assert.equal(shouldHideAppBody(), true);

    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
    assert.equal(document.documentElement.classList.contains('os-desktop-research'), false);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
  });

  test('keeps #appBody visible when Code is foreground over desktop experts', async () => {
    await activateDesktopExperts();
    assert.equal(shouldHideAppBody(), true);

    launchInstance('code');
    assert.equal(shouldHideAppBody(), false);
    assert.equal(document.getElementById('appBody')?.classList.contains('hidden'), false);
    assert.equal(document.documentElement.dataset.osApp, 'code');
    assert.equal(document.documentElement.classList.contains('os-desktop-experts'), false);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
  });
});
