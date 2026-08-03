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
import {
  prepareRepoMapSymbols,
  prepareRepoMapSymbolsForInjection,
} from '../../../server/brain/code/repo-map-symbols.js';

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

/** Noise-heavy fixture: nested constants, callbacks, vitest — injection profile should win. */
function buildInjectionNoiseFixture() {
  const noise = [
    {
      id: 'ws:BaseAgent.decide.system',
      file: 'server/agents/base.ts',
      kind: 'constant',
      signature: 'constant system',
      pagerank: 0.99,
      line_start: 40,
    },
    {
      id: 'ws:BaseAgent.decide.map() callback',
      file: 'server/agents/base.ts',
      kind: 'function',
      signature: 'function map() callback',
      pagerank: 0.98,
      line_start: 50,
    },
    {
      id: 'ws:vitest.value',
      file: 'vitest.setup.ts',
      kind: 'method',
      signature: 'method value()',
      pagerank: 0.97,
      line_start: 1,
    },
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `ws:cardBase${i}`,
      file: `src/components/Panel${i}.tsx`,
      kind: 'constant',
      signature: `constant cardBase${i}`,
      pagerank: 0.85 - i * 0.01,
      line_start: i + 1,
    })),
  ];
  const needles = [
    {
      id: 'ws:executeDay',
      file: 'server/simulation/tick.ts',
      kind: 'function',
      signature: 'function executeDay(): Promise<void>',
      pagerank: 0.88,
      line_start: 88,
    },
    {
      id: 'ws:getOrCreateOrchestrator',
      file: 'server/index.ts',
      kind: 'function',
      signature: 'function getOrCreateOrchestrator(): SimulationOrchestrator',
      pagerank: 0.86,
      line_start: 120,
    },
    {
      id: 'ws:LlmClient',
      file: 'server/llm/client.ts',
      kind: 'class',
      signature: 'class LlmClient',
      pagerank: 0.84,
      line_start: 200,
    },
  ];
  return [...noise, ...needles].sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0));
}

describe('injection repo-map profile', () => {
  const symbols = buildInjectionNoiseFixture();
  const budget = 220;
  const targets = ['executeDay', 'getOrCreateOrchestrator', 'LlmClient'];

  it('injection filtering surfaces navigation needles within budget', () => {
    const wide = prepareRepoMapSymbols(symbols);
    const injection = prepareRepoMapSymbolsForInjection(symbols);
    const wideMap = renderRepoMap(wide, budget);
    const injectionMap = renderRepoMap(injection, budget, { profile: 'injection' });
    const wideHits = scoreRepoMapHits(wideMap.text, targets);
    const injectionHits = scoreRepoMapHits(injectionMap.text, targets);
    assert.ok(injectionHits >= wideHits);
    assert.equal(injectionHits, targets.length);
    assert.ok(!injectionMap.text.includes('## '));
    assert.match(injectionMap.text, /server\/simulation\/tick\.ts:88/);
  });
});
