import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resolveBenchmarkSuites } from '../../src/benchmark/runner.ts';
import type { SuiteId } from '../../src/benchmark/types.ts';
import {
  applyPresetToTogglesForTests,
  getSelectedSuitesForTests,
  getSuiteToggleOrderForTests,
  initBenchmarkPage,
} from '../../src/ui/benchmark-page.ts';

const QUICK_SUITES = resolveBenchmarkSuites('quick');
const FULL_SUITES = resolveBenchmarkSuites('full');

function buildBenchmarkRunBarHtml(): string {
  const toggles = getSuiteToggleOrderForTests()
    .map((id) => {
      const on = QUICK_SUITES.includes(id);
      return `<button type="button" class="benchmark-suite-toggle" data-suite-id="${id}" aria-pressed="${on ? 'true' : 'false'}">${id}</button>`;
    })
    .join('\n');
  return `
    <div class="benchmark-run-bar">
      <button type="button" id="btnBenchmarkQuick">Quick</button>
      <button type="button" id="btnBenchmarkFull">Full</button>
      <button type="button" id="btnBenchmarkStop" disabled>Stop</button>
      <div id="benchmarkSuiteToggles" class="benchmark-suite-toggles" role="group" aria-label="Benchmark suites to run">
        ${toggles}
      </div>
    </div>
  `;
}

function pressedSuiteIds(): SuiteId[] {
  return getSelectedSuitesForTests();
}

function setAllToggles(pressed: boolean): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.benchmark-suite-toggle')) {
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }
}

describe('benchmark suite toggles', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    document.body.innerHTML = buildBenchmarkRunBarHtml();
    initBenchmarkPage();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('clicking a toggle flips aria-pressed', () => {
    const tools = document.querySelector<HTMLButtonElement>(
      '.benchmark-suite-toggle[data-suite-id="tools"]',
    );
    assert.ok(tools);
    assert.equal(tools.getAttribute('aria-pressed'), 'false');
    tools.click();
    assert.equal(tools.getAttribute('aria-pressed'), 'true');
    tools.click();
    assert.equal(tools.getAttribute('aria-pressed'), 'false');
  });

  test('Quick preset selects capability, speed, and modes', () => {
    setAllToggles(false);
    applyPresetToTogglesForTests('quick');
    assert.deepEqual(pressedSuiteIds(), QUICK_SUITES);
  });

  test('Full preset selects all six suites', () => {
    setAllToggles(false);
    applyPresetToTogglesForTests('full');
    assert.deepEqual(pressedSuiteIds(), FULL_SUITES);
  });

  test('getSelectedSuites returns only pressed toggles', () => {
    setAllToggles(false);
    const speed = document.querySelector<HTMLButtonElement>(
      '.benchmark-suite-toggle[data-suite-id="speed"]',
    );
    speed?.click();
    assert.deepEqual(pressedSuiteIds(), ['speed']);
  });
});
