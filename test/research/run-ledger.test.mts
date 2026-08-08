import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ResearchRunLedger, ledgerHost } from '../../src/research/run-ledger.ts';
import type { ResearchProgress } from '../../src/research/types.ts';

const RUN: ResearchProgress[] = [
  { phase: 'probing', model: 'qwen3-30b' },
  { phase: 'planning', planSummary: 'Compare recall and latency across four local models.' },
  {
    phase: 'searching',
    round: 1,
    queryList: ['bge-m3 vs nomic-embed benchmark', 'mteb leaderboard 2026'],
    totalSources: 0,
  },
  {
    phase: 'reading',
    round: 1,
    url: 'https://huggingface.co/spaces/mteb/leaderboard',
    title: 'MTEB leaderboard',
    totalSources: 12,
  },
  {
    phase: 'reading',
    round: 1,
    url: 'https://arxiv.org/abs/2402.03216',
    title: 'BGE-M3',
    totalSources: 18,
  },
  { phase: 'analyzing', round: 1, message: 'Cross-checking claims', totalSources: 18, totalFindings: 4 },
  { phase: 'writing', message: 'Composing the brief', totalSources: 18, totalFindings: 6 },
];

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="ledgerMount"></div>';
  return document.getElementById('ledgerMount') as HTMLElement;
}

describe('research run ledger', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.performance = window.performance;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('records the plan, the queries issued, and each source opened', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    for (const event of RUN) {
      ledger.apply(event);
    }

    assert.match(host.querySelector('.rs-ledger__plan-text')?.textContent ?? '', /recall and latency/);
    assert.equal(host.querySelectorAll('.rs-entry--query').length, 2);
    assert.equal(host.querySelectorAll('.rs-entry--source').length, 2);
    assert.match(host.textContent ?? '', /bge-m3 vs nomic-embed benchmark/);
    assert.match(host.textContent ?? '', /huggingface\.co/);
    assert.equal(ledger.getScanned(), 18);
    assert.equal(ledger.getReadCount(), 2);
  });

  test('marks a round boundary once per round', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.apply({ phase: 'searching', round: 1, queryList: ['a'], totalSources: 0 });
    ledger.apply({ phase: 'searching', round: 1, queryList: ['b'], totalSources: 0 });
    ledger.apply({ phase: 'searching', round: 2, queryList: ['c'], totalSources: 0 });

    const rounds = [...host.querySelectorAll('.rs-round')].map((el) => el.textContent);
    assert.deepEqual(rounds, ['Round 1', 'Round 2']);
  });

  test('the same source is never logged twice', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    const read: ResearchProgress = {
      phase: 'reading',
      round: 1,
      url: 'https://example.com/a',
      title: 'A',
      totalSources: 1,
    };
    ledger.apply(read);
    ledger.apply(read);
    assert.equal(host.querySelectorAll('.rs-entry--source').length, 1);
    assert.equal(ledger.getReadCount(), 1);
  });

  test('the source being read carries a live marker until the run moves on', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.apply({
      phase: 'reading',
      round: 1,
      url: 'https://example.com/a',
      title: 'A',
      totalSources: 1,
    });
    assert.ok(host.querySelector('.rs-entry--source.is-active .rs-spinner'));

    ledger.setRunning(false);
    assert.equal(host.querySelector('.rs-entry--source.is-active'), null);
    assert.equal(host.querySelector('.rs-entry--source .rs-entry__mark')?.textContent, '✓');
  });

  test('only the newest source spins while reading; earlier sources show a check', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.apply({
      phase: 'reading',
      round: 1,
      url: 'https://example.com/a',
      title: 'A',
      totalSources: 2,
    });
    ledger.apply({
      phase: 'reading',
      round: 1,
      url: 'https://example.com/b',
      title: 'B',
      totalSources: 2,
    });

    const marks = [...host.querySelectorAll('.rs-entry--source .rs-entry__mark')];
    assert.equal(marks.length, 2);
    assert.equal(marks[0]?.textContent, '✓');
    assert.ok(marks[1]?.querySelector('.rs-spinner'));
    assert.equal(host.querySelectorAll('.rs-entry--source.is-active').length, 1);
  });

  test('analyzing clears the live marker on the last source', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.apply({
      phase: 'reading',
      round: 1,
      url: 'https://example.com/a',
      title: 'A',
      totalSources: 1,
    });
    ledger.apply({
      phase: 'analyzing',
      round: 1,
      message: 'Synthesizing round 1',
      totalSources: 1,
      totalFindings: 0,
    });

    assert.equal(host.querySelector('.rs-entry--source.is-active'), null);
    assert.equal(host.querySelector('.rs-entry--source .rs-entry__mark')?.textContent, '✓');
    assert.match(host.textContent ?? '', /Synthesizing round 1/);
  });

  test('hydrating a finished run replays the same record without live markers', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.hydrate(RUN);

    assert.equal(host.querySelectorAll('.rs-entry--source').length, 2);
    assert.equal(host.querySelector('.rs-entry--source.is-active'), null);
    assert.equal(host.querySelector('.rs-entry--enter'), null);
    assert.equal(ledger.getReadCount(), 2);
  });

  test('warnings and errors keep their own tone', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.apply({ phase: 'warning', message: 'Search provider rate limited' });
    ledger.apply({ phase: 'error', message: 'Model refused' });
    assert.match(host.querySelector('.rs-entry--warning')?.textContent ?? '', /rate limited/);
    assert.match(host.querySelector('.rs-entry--error')?.textContent ?? '', /Model refused/);
  });

  test('a cancelled run says it stopped early', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.complete('cancelled');
    assert.match(host.textContent ?? '', /Stopped before finishing/);
  });

  test('sources link out, queries do not', () => {
    const host = mount();
    const ledger = new ResearchRunLedger(host);
    ledger.reset();
    ledger.apply({ phase: 'searching', round: 1, queryList: ['a query'], totalSources: 0 });
    ledger.apply({
      phase: 'reading',
      round: 1,
      url: 'https://example.com/a',
      title: 'A',
      totalSources: 1,
    });
    assert.equal(host.querySelector('.rs-entry--query a'), null);
    const link = host.querySelector('.rs-entry--source a') as HTMLAnchorElement;
    assert.equal(link.getAttribute('href'), 'https://example.com/a');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  });
});

describe('ledgerHost', () => {
  test('strips www from web hosts', () => {
    assert.equal(ledgerHost('https://www.example.com/a/b'), 'example.com');
  });

  test('uses the file name for codebase sources', () => {
    assert.equal(ledgerHost('server/research/engine.js'), 'engine.js');
    assert.equal(ledgerHost('file:///workspace/src/research/types.ts'), 'types.ts');
  });
});
