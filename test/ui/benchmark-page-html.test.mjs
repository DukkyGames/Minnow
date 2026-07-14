import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const BENCHMARK_IDS = [
  'btnBenchmark',
  'benchmarkView',
  'btnBenchmarkQuick',
  'btnBenchmarkFull',
  'btnBenchmarkRun',
  'benchmarkSuiteToggles',
  'benchmarkProgress',
  'benchmarkProgressFill',
  'benchmarkSummary',
  'benchmarkHistorySelect',
  'btnBenchmarkBackToCurrent',
  'btnBenchmarkClearHistory',
  'benchmarkSuites',
];

const SUITE_TOGGLE_IDS = [
  'capability',
  'speed',
  'tools',
  'skills',
  'coding',
];

describe('benchmark page HTML', () => {
  for (const id of BENCHMARK_IDS) {
    test(`#${id} exists in index.html`, () => {
      assert.match(html, new RegExp(`id="${id}"`));
    });
  }

  test('benchmark topbar button exists without inline handler', () => {
    assert.match(html, /id="btnBenchmark"/);
    const tag = html.match(/<button[^>]*id="btnBenchmark"[^>]*>/)?.[0] ?? '';
    assert.doesNotMatch(tag, /\bon[a-z]+="/i);
  });

  test('benchmark topbar uses custom icon asset', () => {
    assert.match(html, /id="btnBenchmark"[\s\S]*?src="\/icons\/benchmark\.png"/);
  });

  test('benchmark view is before appBody', () => {
    const bench = html.indexOf('id="benchmarkView"');
    const app = html.indexOf('id="appBody"');
    assert.ok(bench > 0 && app > bench);
  });

  test('custom suites control removed (POLISH-003)', () => {
    assert.doesNotMatch(html, /id="btnBenchmarkCustom"/);
    assert.doesNotMatch(html, /id="benchmarkCustomSuites"/);
  });

  test('suite toggle group has five aria-pressed buttons', () => {
    assert.match(html, /id="benchmarkSuiteToggles"[^>]*role="group"/);
    for (const suiteId of SUITE_TOGGLE_IDS) {
      assert.match(
        html,
        new RegExp(
          `data-suite-id="${suiteId}"[^>]*aria-pressed="(true|false)"`,
        ),
      );
    }
    const toggleMatches = html.match(/class="benchmark-suite-toggle"/g);
    assert.equal(toggleMatches?.length, 5);
  });

  test('page sub-header removed (OS menubar supplies navigation)', () => {
    assert.doesNotMatch(html, /class="benchmark-page-header"/);
    assert.doesNotMatch(html, /id="btnBenchmarkPageBack"/);
  });

  test('separate Stop button removed', () => {
    assert.doesNotMatch(html, /id="btnBenchmarkStop"/);
  });

  test('compare-to-selected-run control removed', () => {
    assert.doesNotMatch(html, /id="benchmarkCompareToggle"/);
    assert.doesNotMatch(html, /Compare to selected run/);
  });

  test('default suite toggles match Quick preset', () => {
    assert.match(html, /data-suite-id="capability"[^>]*aria-pressed="true"/);
    assert.match(html, /data-suite-id="speed"[^>]*aria-pressed="true"/);
    assert.match(html, /data-suite-id="tools"[^>]*aria-pressed="false"/);
    assert.match(html, /data-suite-id="skills"[^>]*aria-pressed="false"/);
    assert.match(html, /data-suite-id="coding"[^>]*aria-pressed="false"/);
  });
});
