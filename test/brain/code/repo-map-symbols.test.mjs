/**
 * Repo-map symbol filtering and formatting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderRepoMap } from '../../../server/brain/code/repo-map.js';
import {
  formatRepoMapSymbolLine,
  isRepoMapTestPath,
  prepareRepoMapSymbols,
} from '../../../server/brain/code/repo-map-symbols.js';

describe('repo-map symbols', () => {
  it('excludes property noise and omits test paths', () => {
    const rows = [
      {
        id: 'ws:src/core.ts:dispatch',
        file: 'src/core.ts',
        kind: 'function',
        signature: 'function dispatch(): void',
        pagerank: 0.4,
        usage_count: 2,
        line_start: 1,
      },
      {
        id: 'ws:test/a.test.ts:status',
        file: 'test/a.test.ts',
        kind: 'property',
        signature: 'property status',
        pagerank: 0.99,
        usage_count: 0,
        line_start: 10,
      },
      {
        id: 'ws:test/a.test.ts:helper',
        file: 'test/a.test.ts',
        kind: 'function',
        signature: 'function helper(): void',
        pagerank: 0.5,
        usage_count: 0,
        line_start: 20,
      },
    ];
    const out = prepareRepoMapSymbols(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].file, 'src/core.ts');
    assert.ok(!out.some((s) => s.kind === 'property'));
    assert.ok(!out.some((s) => s.file.startsWith('test/')));
  });

  it('formatRepoMapSymbolLine adds kind tags and nesting indent', () => {
    const top = formatRepoMapSymbolLine({
      id: 'ws:MyService',
      kind: 'class',
      signature: 'class MyService',
    });
    assert.equal(top, '- [class] MyService');

    const nested = formatRepoMapSymbolLine({
      id: 'ws:MyService.run',
      kind: 'method',
      signature: 'method run(payload: unknown): Promise<void>',
    });
    assert.equal(nested, '  - [method] run(payload: unknown): Promise<void>');
  });

  it('isRepoMapTestPath recognizes test and spec files', () => {
    assert.equal(isRepoMapTestPath('src/foo.ts'), false);
    assert.equal(isRepoMapTestPath('test/brain/foo.test.mjs'), true);
    assert.equal(isRepoMapTestPath('src/foo.spec.ts'), true);
    assert.equal(isRepoMapTestPath('test/fixtures/sample.ts'), true);
  });

  it('rendered map prefers src symbols over test properties at same budget', () => {
    const rows = prepareRepoMapSymbols([
      {
        id: 'ws:dispatch',
        file: 'src/engine.ts',
        kind: 'function',
        signature: 'function dispatch(): void',
        pagerank: 0.3,
        usage_count: 1,
        line_start: 1,
      },
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `ws:test/huge.test.ts:case${i}.status`,
        file: 'test/huge.test.ts',
        kind: 'property',
        signature: 'property status',
        pagerank: 0.95,
        usage_count: 0,
        line_start: i + 1,
      })),
    ]);
    const map = renderRepoMap(rows, 120);
    assert.ok(map.text.includes('dispatch'));
    assert.ok(!map.text.includes('property status'));
  });
});
