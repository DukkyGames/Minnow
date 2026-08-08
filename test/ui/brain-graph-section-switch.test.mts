/**
 * Leaving Brain Graph must drop canvas interaction so other sections use normal cursors.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { installHappyDomGlobals, teardownHappyDomAsync } from '../os/dom-helpers.mts';

const BRAIN_SECTION_IDS = [
  'graph',
  'edit',
  'log',
  'schema',
  'proposals',
  'memories',
  'ingest',
  'lint',
  'code',
  'settings',
] as const;

function setupBrainDom(doc: Document): void {
  const sectionPanels = BRAIN_SECTION_IDS.map(
    (id) =>
      `<section id="brainSection-${id}" class="brain-section brain-section--${id}"></section>`,
  ).join('');
  const navButtons = BRAIN_SECTION_IDS.map(
    (id) =>
      `<button type="button" class="brain-rail__btn" data-brain-nav="${id}" title="${id}"></button>`,
  ).join('');

  doc.body.innerHTML = `
    <div id="appBody"></div>
    <main id="brainView" class="brain-page is-graph-canvas-bg" aria-label="Brain">
      <div class="brain-page-chrome">
        <header class="brain-page-header brain-overlay-surface">
          <h1 id="brainPageHeaderTitle"></h1>
          <p id="brainPageHeaderLead"></p>
          <div id="brainPageHeaderActions"></div>
          <button type="button" id="btnBrainPageBack" aria-label="Back"></button>
        </header>
        <div class="brain-page-body">
          <nav class="brain-rail brain-overlay-surface" aria-label="Brain sections">${navButtons}</nav>
          <div class="brain-stage">
            <div class="brain-content">${sectionPanels}</div>
            <aside id="brainInspector"></aside>
          </div>
        </div>
      </div>
      <div id="brainGraphCanvasWrap" class="brain-graph-canvas-wrap brain-graph-page-bg">
        <canvas id="brainGraphCanvas" class="brain-graph-canvas" width="64" height="64"></canvas>
      </div>
    </main>
  `;
}

describe('brain graph section switch', () => {
  /** @type {import('happy-dom').Window | undefined} */
  let happyDomWindow: import('happy-dom').Window | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    happyDomWindow = win;
    installHappyDomGlobals(win);
    setupBrainDom(win.document);

    const { resetBrainPageForTests, initBrainPage, openBrain } = await import(
      '../../src/ui/brain-page.ts'
    );
    resetBrainPageForTests();
    initBrainPage();
    openBrain('graph');
  });

  afterEach(async () => {
    const { resetBrainPageForTests } = await import('../../src/ui/brain-page.ts');
    resetBrainPageForTests();
    await teardownHappyDomAsync(happyDomWindow);
    happyDomWindow = undefined;
  });

  test('settings section clears graph canvas background mode', () => {
    const root = document.getElementById('brainView');
    const canvas = document.getElementById('brainGraphCanvas') as HTMLCanvasElement | null;
    assert.ok(root?.classList.contains('is-graph-canvas-bg'));

    canvas.style.cursor = 'pointer';
    document.body.style.cursor = 'grab';

    document.querySelector('[data-brain-nav="settings"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    assert.equal(root?.classList.contains('is-graph-canvas-bg'), false);
    assert.equal(document.getElementById('brainSection-settings')?.classList.contains('is-active'), true);
    assert.equal(canvas.style.cursor, '');
    assert.equal(document.body.style.cursor, '');
  });
});
