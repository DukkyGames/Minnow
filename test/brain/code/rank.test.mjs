/**
 * Deterministic PageRank and repo-map token budgeting (MIN-B7).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAdjacency,
  buildPersonalizationVector,
  estimateTokens,
  personalizedPageRank,
} from '../../../server/brain/code/rank.js';
import { renderRepoMap } from '../../../server/brain/code/repo-map.js';

describe('code index rank', () => {
  it('personalizedPageRank is deterministic for the same graph', () => {
    const edges = [
      { src_symbol: 'ws:a', dst_symbol: 'ws:b' },
      { src_symbol: 'ws:b', dst_symbol: 'ws:c' },
      { src_symbol: 'ws:c', dst_symbol: 'ws:a' },
    ];
    const { out, nodes } = buildAdjacency(edges);
    const personal = new Map([
      ['ws:a', 0.5],
      ['ws:b', 0.3],
      ['ws:c', 0.2],
    ]);

    const first = personalizedPageRank(out, nodes, personal);
    const second = personalizedPageRank(out, nodes, personal);

    assert.equal(first.size, 3);
    for (const id of nodes) {
      assert.equal(first.get(id), second.get(id));
      assert.ok((first.get(id) ?? 0) > 0);
    }
  });

  it('buildPersonalizationVector boosts focus files', () => {
    const nodes = new Set(['ws:a', 'ws:b']);
    const symbols = [
      { id: 'ws:a', file: 'src/a.ts', usage_count: 0 },
      { id: 'ws:b', file: 'src/b.ts', usage_count: 0 },
    ];
    const focus = new Set(['src/a.ts']);
    const weights = buildPersonalizationVector(nodes, symbols, focus);
    assert.ok((weights.get('ws:a') ?? 0) > (weights.get('ws:b') ?? 0));
  });

  it('renderRepoMap respects the token budget', () => {
    const symbols = [];
    for (let i = 0; i < 200; i += 1) {
      symbols.push({
        id: `ws:fn${i}`,
        file: `src/file${i % 5}.ts`,
        signature: `function fn${i}(arg${i}: string): Promise<void>`,
        kind: 'function',
        pagerank: 1 - i * 0.001,
      });
    }
    const budget = 120;
    const map = renderRepoMap(symbols, budget);
    assert.ok(map.tokenEstimate <= budget + estimateTokens('- … (truncated to token budget)'));
    assert.match(map.text, /^# Repo map/);
    assert.equal(map.truncated, true);
  });
});
