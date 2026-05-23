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
  'btnBenchmarkPageBack',
  'btnBenchmarkQuick',
  'btnBenchmarkFull',
  'btnBenchmarkStop',
  'benchmarkProgress',
  'benchmarkProgressFill',
  'benchmarkSummary',
  'benchmarkHistorySelect',
  'benchmarkCompareToggle',
  'benchmarkSuites',
];

describe('benchmark page HTML', () => {
  for (const id of BENCHMARK_IDS) {
    test(`#${id} exists in index.html`, () => {
      assert.match(html, new RegExp(`id="${id}"`));
    });
  }

  test('benchmark topbar button calls openBenchmarkFromTopbar', () => {
    assert.match(html, /id="btnBenchmark"[^>]*onclick="openBenchmarkFromTopbar\(\)"/);
  });

  test('benchmark topbar uses custom icon asset', () => {
    assert.match(html, /id="btnBenchmark"[\s\S]*?src="\/icons\/benchmark\.png"/);
  });

  test('benchmark view is before appBody', () => {
    const bench = html.indexOf('id="benchmarkView"');
    const app = html.indexOf('id="appBody"');
    assert.ok(bench > 0 && app > bench);
  });
});
