import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { getForegroundAppId, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  activateDesktopResearch,
  getDesktopState,
  isDesktopResearchActive,
  isDesktopResearchRunActive,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  launchApp,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
} from '../../src/os/router.ts';
import { renderDesktop } from '../../src/os/desktop.ts';
import { installHappyDomGlobals } from './dom-helpers.mts';

function setupDesktopDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage">
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osAppsLayer"></div>
    </div>
    <input type="file" id="fileInput" />
  `;
}

describe('desktop research state', () => {
  let cleanupDesktop: (() => void) | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/config/research')) {
        return {
          ok: true,
          json: async () => ({ model: { providerId: '', model: '' }, maxRounds: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    installHappyDomGlobals(win, { fetch: fetchImpl });
    setupDesktopDom(win);
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    const layer = document.getElementById('osDesktopLayer')!;
    cleanupDesktop = renderDesktop(layer);
    initOsRouter();
  });

  afterEach(() => {
    cleanupDesktop?.();
    cleanupDesktop = undefined;
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('starts without research mode classes', () => {
    assert.equal(getDesktopState(), 'idle');
    assert.equal(isDesktopResearchActive(), false);
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-research-mode'), false);
    assert.equal(layer?.classList.contains('is-research-active'), false);
  });

  test('activateDesktopResearch launches Code research panel route', async () => {
    await activateDesktopResearch({ seed: 'quantum computing' });
    assert.equal(window.location.hash, '#/app/code/chat');
  });

  test('resolveLegacyHash redirects research routes to Code embed', () => {
    assert.deepEqual(resolveLegacyHash('#/research'), {
      hash: '#/app/code/chat',
      codeResearch: true,
    });
    assert.deepEqual(resolveLegacyHash('#/app/research'), {
      hash: '#/app/code/chat',
      codeResearch: true,
    });
  });

  test('launchApp(research) routes to Code and opens panel when DOM is ready', async () => {
    const { isResearchPanelOpen, resetResearchPanelForTests } = await import(
      '../../src/ui/research-panel.ts',
    );
    resetResearchPanelForTests();
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div id="chatArea"></div>
      <div id="mainColumn"></div>
      <main id="researchView" class="research-page dr">
        <button id="researchTabRun"></button>
        <button id="researchTabLibrary"></button>
        <div id="researchPanelRun">
          <textarea id="researchQuery"></textarea>
          <select id="researchMaxRounds"><option value="auto">Auto</option></select>
          <select id="researchCategory"><option value=""></option></select>
          <select id="researchSearchProvider"><option value=""></option></select>
          <select id="researchProviderOverride"><option value=""></option></select>
          <input id="researchModelOverride" />
          <button id="btnResearchStart"></button>
          <button id="btnResearchCancel" hidden></button>
          <div id="researchProgressMount"></div>
          <div id="researchResultMount"></div>
        </div>
        <div id="researchPanelLibrary" class="hidden"></div>
        <div id="researchLibraryMount"></div>
        <button id="btnResearchSettingsLink"></button>
      </main>
    `,
    );
    launchApp('code');
    launchApp('research', { seed: 'Apple stock' });
    assert.equal(window.location.hash, '#/app/code/chat');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(isResearchPanelOpen(), true);
    const snap = await import('../../src/os/instances.ts').then((m) => m.getInstanceSnapshot());
    assert.equal(snap.instances.find((i) => i.appId === 'research'), undefined);
    assert.equal(getForegroundAppId(), 'code');
  });

  test('parseOsHash still accepts workspaces route alias', () => {
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'workspaces' });
  });
});
