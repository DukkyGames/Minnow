import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  activateDesktopExperts,
  getDesktopState,
  isDesktopExpertsActive,
  isDesktopExpertsHubActive,
  resetDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import {
  closeDesktopExpertsLab,
  openDesktopExpertsLab,
} from '../../src/os/experts-desktop.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  launchApp,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
} from '../../src/os/router.ts';
import { renderDesktop } from '../../src/os/desktop.ts';

function setupDesktopDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage">
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osAppsLayer">
        <main id="expertsView" class="experts-page" data-step="browse">
          <header class="experts-hdr">
            <div class="experts-hdr-spacer"></div>
            <button type="button" class="experts-hdr-btn" id="btnExpertsNew">New expert</button>
          </header>
          <div id="expertsList"></div>
          <div id="expertsDetailMount"></div>
          <div id="expertsDisabled" class="hidden"></div>
        </main>
      </div>
    </div>
    <div id="appBody"></div>
    <input type="file" id="fileInput" />
  `;
}

describe('desktop experts state', () => {
  let cleanupDesktop: (() => void) | undefined;

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
    const fetchImpl = (async (input: string | URL | Request) => {
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, 'http://localhost:5173').href;
      if (url.includes('/api/config/experts') || url.includes('/api/config/meta')) {
        return {
          ok: true,
          json: async () => ({ experts: { enabled: true } }),
        } as Response;
      }
      if (url.includes('/api/prompts/experts')) {
        return { ok: true, json: async () => ({ files: [] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    win.fetch = fetchImpl;
    g.fetch = fetchImpl;
    setupDesktopDom(win);
    win.location.href = 'http://localhost:5173/#/desktop';
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

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 120));
    cleanupDesktop?.();
    cleanupDesktop = undefined;
    resetDesktopStateForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('starts without experts mode classes', () => {
    assert.equal(getDesktopState(), 'idle');
    assert.equal(isDesktopExpertsActive(), false);
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-experts-mode'), false);
    assert.equal(layer?.classList.contains('is-experts-active'), false);
  });

  test('activateDesktopExperts stays in experts-idle with hero picker', async () => {
    await activateDesktopExperts({ expertId: 'software-engineer' });
    await import('../../src/ui/experts/experts-hub.ts').then((m) => m.refreshExpertsEnabledState());
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(getDesktopState(), 'expertsIdle');
    assert.equal(isDesktopExpertsActive(), true);
    assert.equal(isDesktopExpertsHubActive(), false);
    const layer = document.getElementById('osDesktopLayer');
    assert.equal(layer?.classList.contains('is-experts-idle'), true);
    assert.equal(layer?.classList.contains('is-experts-active'), false);
    assert.equal(layer?.classList.contains('is-experts-mode'), true);
    const heroMount = document.getElementById('desktopExpertsHeroMount');
    assert.equal(heroMount?.classList.contains('hidden'), false);
    assert.ok(heroMount && heroMount.childElementCount > 0);
    const view = document.getElementById('expertsView');
    assert.equal(view?.classList.contains('is-open'), false);
    const greetSub = document.querySelector('.mn-os-desk-hero .mn-os-greet-sub');
    assert.equal(
      greetSub?.textContent,
      'Choose a specialist below, or open the lab to compose and tune experts.',
    );
  });

  test('openDesktopExpertsLab promotes to experts-active with mounted panel', async () => {
    await activateDesktopExperts();
    await openDesktopExpertsLab({ expertId: 'software-engineer' });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(getDesktopState(), 'expertsActive');
    assert.equal(isDesktopExpertsHubActive(), true);
    const mount = document.getElementById('desktopExpertsMount');
    const view = document.getElementById('expertsView');
    assert.ok(mount?.contains(view ?? null));
    assert.equal(view?.classList.contains('is-open'), true);
    assert.equal(view?.classList.contains('is-active'), true);
    assert.ok(document.getElementById('btnExpertsLabBack'));
    const closeBtn = document.getElementById('btnExpertsLabBack');
    assert.equal(closeBtn?.textContent, 'Close');
    const newBtn = document.getElementById('btnExpertsNew');
    assert.ok(newBtn && closeBtn && newBtn.nextElementSibling === closeBtn);
  });

  test('closeDesktopExpertsLab returns to hero picker', async () => {
    await activateDesktopExperts();
    await openDesktopExpertsLab();
    await new Promise((r) => setTimeout(r, 0));
    closeDesktopExpertsLab();
    assert.equal(getDesktopState(), 'expertsIdle');
    assert.equal(isDesktopExpertsHubActive(), false);
    const view = document.getElementById('expertsView');
    assert.equal(view?.classList.contains('is-open'), false);
    const heroMount = document.getElementById('desktopExpertsHeroMount');
    assert.equal(heroMount?.classList.contains('hidden'), false);
  });

  test('resolveLegacyHash redirects experts routes to desktop', () => {
    assert.deepEqual(resolveLegacyHash('#/experts'), {
      hash: '#/desktop',
      desktopExperts: true,
    });
    assert.deepEqual(resolveLegacyHash('#/app/experts'), {
      hash: '#/desktop',
      desktopExperts: true,
    });
  });

  test('launchApp(experts) stays on desktop in experts-idle', async () => {
    launchApp('experts');
    assert.equal(window.location.hash, '#/desktop');
    await import('../../src/ui/experts/experts-hub.ts').then((m) => m.refreshExpertsEnabledState());
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(isDesktopExpertsActive(), true);
    assert.equal(getDesktopState(), 'expertsIdle');
    const snap = await import('../../src/os/instances.ts').then((m) => m.getInstanceSnapshot());
    assert.equal(snap.instances.find((i) => i.appId === 'experts'), undefined);
  });

  test('parseOsHash still accepts desktop route', () => {
    assert.deepEqual(parseOsHash('#/desktop'), { view: 'desktop' });
  });
});
