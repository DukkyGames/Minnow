import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  initResearchPage,
  isResearchStartDisabledForTests,
  openResearchReport,
  resetResearchPanelStateForTests,
  setBriefTabVisibleForTests,
  setResearchRunningForTests,
} from '../../src/research/panel.ts';
import { resetResearchOptionChipsForTests } from '../../src/research/option-chips.ts';

function buildResearchPageHtml(): string {
  return `
    <main id="researchView" class="research-page">
      <aside class="rs-rail">
        <div class="rs-rail__head"><button type="button" id="btnResearchNew"></button></div>
        <input type="search" id="researchRailFilter" />
        <div id="researchRailList"></div>
        <input type="checkbox" id="researchRailArchived" />
        <button type="button" id="btnResearchSettingsLink"></button>
      </aside>
      <section class="rs-main">
        <div class="rs-pane rs-pane--ask" id="researchAskPane">
          <div class="rs-ask">
            <div class="rs-composer">
              <textarea id="researchQuery"></textarea>
              <div class="rs-opts">
                <div class="rs-opt">
                  <button type="button" id="chipResearchScope" aria-expanded="false">
                    <span data-chip-value></span>
                  </button>
                  <div class="rs-pop" id="popResearchScope" hidden>
                    <select id="researchScope"><option value="web">Web</option><option value="codebase">Codebase</option></select>
                    <div id="researchWorkspaceField" hidden><select id="researchWorkspace"></select></div>
                  </div>
                </div>
                <div class="rs-opt">
                  <button type="button" id="chipResearchRounds" aria-expanded="false">
                    <span data-chip-value></span>
                  </button>
                  <div class="rs-pop" id="popResearchRounds" hidden>
                    <select id="researchMaxRounds"><option value="auto">Auto</option><option value="3">3 rounds</option></select>
                  </div>
                </div>
                <div class="rs-opt">
                  <button type="button" id="chipResearchCategory" aria-expanded="false">
                    <span data-chip-value></span>
                  </button>
                  <div class="rs-pop" id="popResearchCategory" hidden>
                    <select id="researchCategory"><option value="">Auto</option><option value="news">News</option></select>
                  </div>
                </div>
                <div class="rs-opt">
                  <button type="button" id="chipResearchEngine" aria-expanded="false"></button>
                  <div class="rs-pop" id="popResearchEngine" hidden>
                    <select id="researchSearchProvider"><option value=""></option><option value="brave">Brave</option></select>
                    <div id="researchComposerModelAnchor" class="rs-model-anchor"></div>
                    <button type="button" id="btnResearchClearModel" hidden>Use default</button>
                    <input type="hidden" id="researchProviderOverride" value="" />
                    <input type="hidden" id="researchModelOverride" value="" />
                  </div>
                </div>
                <span id="researchEngineDot" hidden></span>
              </div>
              <button type="button" id="btnResearchCancel" hidden>Stop</button>
              <button type="button" id="btnResearchStart" aria-label="Start research"></button>
            </div>
          </div>
        </div>
        <div class="rs-pane rs-pane--run" id="researchRunPane" hidden>
          <h2 id="researchRunTitle"></h2>
          <span id="researchRunState"></span>
          <span id="researchRunStats"></span>
          <div id="researchRunActions"></div>
          <button type="button" id="researchViewBrief" class="rs-segment is-on"></button>
          <button type="button" id="researchViewEvidence" class="rs-segment"></button>
          <div id="researchResultMount"></div>
          <div id="researchProgressMount" hidden></div>
        </div>
      </section>
    </main>
    <div id="appBody"></div>
  `;
}

describe('research panel', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.performance = window.performance;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    document.body.innerHTML = buildResearchPageHtml();
    resetResearchPanelStateForTests();
    resetResearchOptionChipsForTests();
    initResearchPage();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('Brief tab is hidden until a saved report is ready', () => {
    const briefTab = document.getElementById('researchViewBrief') as HTMLButtonElement;
    const evidenceTab = document.getElementById('researchViewEvidence') as HTMLButtonElement;
    setBriefTabVisibleForTests(false);
    assert.equal(briefTab.hidden, true);
    assert.equal(evidenceTab.classList.contains('is-on'), true);

    setBriefTabVisibleForTests(true);
    assert.equal(briefTab.hidden, false);
  });

  test('running state disables Start and shows Stop', () => {
    setResearchRunningForTests(true);
    assert.equal(isResearchStartDisabledForTests(), true);
    const cancel = document.getElementById('btnResearchCancel') as HTMLButtonElement;
    assert.equal(cancel.hidden, false);
    const start = document.getElementById('btnResearchStart') as HTMLButtonElement;
    assert.equal(start.getAttribute('aria-label'), 'Research running');
    assert.ok(start.querySelector('.rs-spinner'));

    setResearchRunningForTests(false);
    assert.equal(isResearchStartDisabledForTests(), false);
    assert.equal(cancel.hidden, true);
    assert.equal(start.getAttribute('aria-label'), 'Start research');
  });

  test('running state disables the option chips so a run cannot be re-aimed mid-flight', () => {
    setResearchRunningForTests(true);
    const scope = document.getElementById('chipResearchScope') as HTMLButtonElement;
    assert.equal(scope.disabled, true);
    setResearchRunningForTests(false);
    assert.equal(scope.disabled, false);
  });

  test('chips show the current value of their control', () => {
    const rounds = document.getElementById('researchMaxRounds') as HTMLSelectElement;
    const chip = document.getElementById('chipResearchRounds') as HTMLButtonElement;
    assert.equal(chip.querySelector('[data-chip-value]')?.textContent, 'Auto depth');

    rounds.value = '3';
    rounds.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(chip.querySelector('[data-chip-value]')?.textContent, '3 rounds');
    assert.ok(chip.classList.contains('is-set'));
  });

  test('a chip opens exactly one popover at a time', () => {
    const scopeChip = document.getElementById('chipResearchScope') as HTMLButtonElement;
    const roundsChip = document.getElementById('chipResearchRounds') as HTMLButtonElement;
    const scopePop = document.getElementById('popResearchScope') as HTMLElement;
    const roundsPop = document.getElementById('popResearchRounds') as HTMLElement;

    scopeChip.click();
    assert.equal(scopePop.hidden, false);
    assert.equal(scopeChip.getAttribute('aria-expanded'), 'true');

    roundsChip.click();
    assert.equal(scopePop.hidden, true);
    assert.equal(roundsPop.hidden, false);

    roundsChip.click();
    assert.equal(roundsPop.hidden, true);
  });

  test('openResearchReport uses external surface while research page is open', () => {
    const researchView = document.getElementById('researchView')!;
    researchView.classList.add('is-open');
    let openedUrl = '';
    window.open = ((url: string) => {
      openedUrl = url;
      return null;
    }) as typeof window.open;

    openResearchReport('rs-abc123456789');

    assert.match(openedUrl, /\/api\/research\/report\/rs-abc123456789/);
    researchView.classList.remove('is-open');
  });
});
