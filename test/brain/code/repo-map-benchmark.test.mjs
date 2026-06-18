/**
 * MIN-B11 — repo-map navigation benchmark (rank-ordered rendering vs alphabetical files).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  firstLineIndexForNeedle,
  renderRepoMap,
  scoreRepoMapHits,
} from '../../../server/brain/code/repo-map.js';

/** Synthetic symbols: high PageRank lives in late-alphabet files (z.ts). */
function buildNavigationFixture() {
  const symbols = [];
  for (let i = 0; i < 30; i += 1) {
    symbols.push({
      id: `ws:low${i}`,
      file: `src/a/low${i}.ts`,
      signature: `function lowPriority${i}(): void`,
      kind: 'function',
      pagerank: 0.001 * (30 - i),
    });
  }
  for (let i = 0; i < 5; i += 1) {
    symbols.push({
      id: `ws:high${i}`,
      file: `src/z/core${i}.ts`,
      signature: `function dispatchHandler${i}(payload: unknown): Promise<void>`,
      kind: 'function',
      pagerank: 0.9 - i * 0.05,
    });
  }
  return symbols.sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0));
}

/** Alphabetical file grouping — pre-MIN-B11 behavior that displaced ranked symbols. */
function renderRepoMapAlphabeticalFiles(symbols, tokenBudget, opts = {}) {
  const budget = Math.max(50, Math.floor(tokenBudget));
  const focus = opts.focus?.trim().toLowerCase();
  const lines = ['# Repo map'];
  let used = 4;

  const byFile = new Map();
  for (const sym of symbols) {
    if (focus) {
      const hay = `${sym.id} ${sym.file} ${sym.signature}`.toLowerCase();
      if (!hay.includes(focus)) continue;
    }
    const list = byFile.get(sym.file) ?? [];
    list.push(sym);
    byFile.set(sym.file, list);
  }

  for (const file of [...byFile.keys()].sort()) {
    const header = `\n## ${file}`;
    const headerTokens = Math.ceil(header.length / 4);
    if (used + headerTokens > budget) break;
    lines.push(header);
    used += headerTokens;
    for (const sym of byFile.get(file) ?? []) {
      const line = `- ${sym.signature}`;
      const lineTokens = Math.ceil(line.length / 4);
      if (used + lineTokens > budget) {
        return { text: lines.join('\n'), truncated: true };
      }
      lines.push(line);
      used += lineTokens;
    }
  }

  return { text: lines.join('\n'), truncated: false };
}

describe('MIN-B11 repo-map benchmark', () => {
  const symbols = buildNavigationFixture();
  const budget = 180;
  const targets = ['dispatchHandler0', 'dispatchHandler1'];

  it('rank-ordered map surfaces high-value symbols within token budget', () => {
    const map = renderRepoMap(symbols, budget);
    const hits = scoreRepoMapHits(map.text, targets);
    assert.equal(hits, targets.length);
    assert.ok(firstLineIndexForNeedle(map.text, 'dispatchHandler0') >= 0);
    assert.ok(
      firstLineIndexForNeedle(map.text, 'dispatchHandler0') <
        firstLineIndexForNeedle(map.text, 'lowPriority0'),
    );
  });

  it('alphabetical file sort misses late-file high-rank symbols at the same budget', () => {
    const baseline = renderRepoMapAlphabeticalFiles(symbols, budget);
    const tuned = renderRepoMap(symbols, budget);
    const baselineHits = scoreRepoMapHits(baseline.text, targets);
    const tunedHits = scoreRepoMapHits(tuned.text, targets);
    assert.ok(tunedHits > baselineHits);
    assert.equal(tunedHits, targets.length);
    assert.ok(baselineHits < targets.length);
  });
});
