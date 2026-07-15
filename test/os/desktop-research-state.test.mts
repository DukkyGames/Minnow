import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
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

  test('activateDesktopResearch applies research-idle and placeholder', async () => {
    await activateDesktopResearch({ seed: 'quantum computing' });
    assert.equal(getDesktopState(), 'researchIdle');
    assert.equal(isDesktopResearchActive(), true);
    assert.equal(isDesktopResearchRunActive(), false);
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-research-idle'), true);
    assert.equal(layer?.classList.contains('is-research-mode'), true);
    assert.equal(layer?.classList.contains('is-composer-docked'), true);
    const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
    assert.equal(input?.placeholder, 'What would you like to research?');
    const greet = document.querySelector('.mn-os-desk-hero .mn-os-greet');
    const greetSub = document.querySelector('.mn-os-desk-hero .mn-os-greet-sub');
    assert.equal(greet?.textContent, 'Deep research.');
    assert.equal(
      greetSub?.textContent,
      "What would you like to research? I'll gather sources and synthesize a report.",
    );
    assert.equal(input?.value, 'quantum computing');
    const dock = document.querySelector('.mn-os-composer-dock');
    const composer = document.getElementById('desktopComposerRoot');
    assert.ok(dock?.contains(composer ?? null));
    const overlay = document.querySelector('.mn-os-desktop-research');
    assert.ok(overlay);
    assert.ok(document.getElementById('desktopResearchProgressMount'));
    assert.ok(document.getElementById('desktopResearchProgressBody'));
    assert.ok(document.getElementById('desktopResearchResultMount'));
    assert.ok(document.getElementById('desktopResearchResultBody'));
    assert.ok(document.getElementById('btnDesktopResearchClose'));
    assert.ok(document.getElementById('desktopResearchMaxRounds'));
    assert.ok(document.getElementById('desktopResearchScope'));
  });

  test('resolveLegacyHash redirects research routes to desktop', () => {
    assert.deepEqual(resolveLegacyHash('#/research'), {
      hash: '#/desktop',
      desktopResearch: true,
    });
    assert.deepEqual(resolveLegacyHash('#/app/research'), {
      hash: '#/desktop',
      desktopResearch: true,
    });
  });

  test('launchApp(research) without options still activates research idle', async () => {
    launchApp('research');
    assert.equal(window.location.hash, '#/desktop');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(isDesktopResearchActive(), true);
    assert.equal(getDesktopState(), 'researchIdle');
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-research-mode'), true);
  });

  test('launchApp(research) stays on desktop and activates research idle', async () => {
    launchApp('research', { seed: 'Apple stock' });
    assert.equal(window.location.hash, '#/desktop');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(isDesktopResearchActive(), true);
    assert.equal(getDesktopState(), 'researchIdle');
    const snap = await import('../../src/os/instances.ts').then((m) => m.getInstanceSnapshot());
    assert.equal(snap.instances.find((i) => i.appId === 'research'), undefined);
  });

  test('parseOsHash still accepts desktop route', () => {
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'desktop' });
  });
});
