import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { formatRunDuration } from '../../src/research/run-summary.ts';
import {
  mergeResearchRuns,
  renderResearchRail,
  researchRunGroup,
  researchRunMeta,
  setActiveResearchRow,
} from '../../src/research/library.ts';
import type { ResearchLibraryItem } from '../../src/research/types.ts';

const NOW = new Date('2026-01-08T12:00:00.000Z').getTime();

const DONE: ResearchLibraryItem = {
  id: 'rs-aaaaaaaaaaaa',
  query: 'Best local LLM stacks',
  status: 'done',
  category: 'market',
  sourceCount: 11,
  rounds: 3,
  duration: '2:48',
  startedAt: '2026-01-08T09:00:00.000Z',
  completedAt: '2026-01-08T09:30:00.000Z',
};

const OLDER: ResearchLibraryItem = {
  id: 'rs-bbbbbbbbbbbb',
  query: 'Vector database tradeoffs',
  status: 'done',
  sourceCount: 4,
  completedAt: '2025-12-01T09:30:00.000Z',
};

function mountRail(): HTMLElement {
  document.body.innerHTML = '<div id="researchRailList"></div>';
  return document.getElementById('researchRailList') as HTMLElement;
}

const NOOP = {
  onSelect: () => {},
  onOpenReport: () => {},
  onDiscuss: () => {},
  onRefine: () => {},
  onChanged: () => {},
};

describe('research rail', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/research/library')) {
        const archived = url.includes('archived=true');
        return new Response(JSON.stringify({ items: archived ? [] : [DONE, OLDER] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  test('prefers report title over query in the rail', async () => {
    const mount = mountRail();
    const titled: ResearchLibraryItem = {
      ...DONE,
      title: 'Widget Market Analysis',
      query: 'long original research question about widgets',
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/research/library')) {
        return new Response(JSON.stringify({ items: [titled] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    }) as typeof fetch;

    await renderResearchRail({ mount, ...NOOP });
    const title = mount.querySelector('.rs-row__title');
    assert.equal(title?.textContent, 'Widget Market Analysis');
  });

  test('renders runs as rows grouped by recency', async () => {
    const mount = mountRail();
    await renderResearchRail({ mount, ...NOOP });

    const rows = mount.querySelectorAll('.rs-row');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].getAttribute('data-research-id'), 'rs-aaaaaaaaaaaa');
    assert.match(mount.textContent ?? '', /Best local LLM stacks/);

    const labels = [...mount.querySelectorAll('.rs-group__label')].map((el) => el.textContent);
    assert.ok(labels.length >= 1, 'rail should carry at least one group heading');
  });

  test('rows are rows, not cards', async () => {
    const mount = mountRail();
    await renderResearchRail({ mount, ...NOOP });
    assert.equal(mount.querySelector('.dr-lib-card'), null);
    assert.equal(mount.querySelector('.dr-lib-grid'), null);
  });

  test('an in-flight run is merged in ahead of saved work', async () => {
    const mount = mountRail();
    const live: ResearchLibraryItem = {
      id: 'rs-cccccccccccc',
      query: 'Streaming right now',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await renderResearchRail({ mount, liveRuns: [live], ...NOOP });

    const rows = mount.querySelectorAll('.rs-row');
    assert.equal(rows[0].getAttribute('data-research-id'), 'rs-cccccccccccc');
    assert.match(rows[0].textContent ?? '', /running/);
    assert.equal(mount.querySelector('.rs-group__label')?.textContent, 'Running');
  });

  test('selecting a row calls back with its id', async () => {
    const mount = mountRail();
    let picked = '';
    await renderResearchRail({ mount, ...NOOP, onSelect: (id) => { picked = id; } });
    (mount.querySelector('.rs-row') as HTMLButtonElement).click();
    assert.equal(picked, 'rs-aaaaaaaaaaaa');
  });

  test('the row menu opens beside the row, never nested inside the row button', async () => {
    const mount = mountRail();
    await renderResearchRail({ mount, ...NOOP });
    const menuBtn = mount.querySelector('.rs-row__menu') as HTMLButtonElement;
    assert.ok(menuBtn);
    assert.equal(menuBtn.closest('.rs-row'), null, 'menu button must not nest inside the row button');

    menuBtn.click();
    const menu = document.querySelector('.rs-menu');
    assert.ok(menu, 'menu should render');
    assert.match(menu?.textContent ?? '', /Archive/);
    assert.match(menu?.textContent ?? '', /Delete/);
  });

  test('a running row offers no report actions it cannot deliver', async () => {
    const mount = mountRail();
    const live: ResearchLibraryItem = {
      id: 'rs-cccccccccccc',
      query: 'Streaming right now',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await renderResearchRail({ mount, liveRuns: [live], ...NOOP });
    (mount.querySelector('.rs-row__menu') as HTMLButtonElement).click();
    const menu = document.querySelector('.rs-menu');
    assert.doesNotMatch(menu?.textContent ?? '', /Open report/);
    assert.doesNotMatch(menu?.textContent ?? '', /Discuss/);
  });

  test('empty archived view explains itself', async () => {
    const mount = mountRail();
    await renderResearchRail({ mount, archived: true, ...NOOP });
    assert.match(mount.textContent ?? '', /No archived runs/);
  });

  test('setActiveResearchRow moves the selection without a refetch', async () => {
    const mount = mountRail();
    await renderResearchRail({ mount, ...NOOP });
    setActiveResearchRow(mount, 'rs-bbbbbbbbbbbb');
    const active = mount.querySelector('.rs-row.is-active');
    assert.equal(active?.getAttribute('data-research-id'), 'rs-bbbbbbbbbbbb');
    assert.equal(active?.getAttribute('aria-selected'), 'true');
  });
});

describe('research rail grouping', () => {
  test('running work always sorts into its own group', () => {
    assert.equal(researchRunGroup({ ...DONE, status: 'running' }, NOW), 'Running');
  });

  test('buckets fall back through today, yesterday, week, month', () => {
    assert.equal(researchRunGroup(DONE, NOW), 'Today');
    assert.equal(
      researchRunGroup({ ...DONE, completedAt: '2026-01-07T09:30:00.000Z' }, NOW),
      'Yesterday',
    );
    assert.equal(
      researchRunGroup({ ...DONE, completedAt: '2026-01-04T09:30:00.000Z' }, NOW),
      'This week',
    );
    assert.equal(researchRunGroup(OLDER, NOW), 'Earlier');
  });

  test('undated runs are grouped rather than dropped', () => {
    assert.equal(
      researchRunGroup({ id: 'x', query: 'q', status: 'done' }, NOW),
      'Undated',
    );
  });

  test('merge dedupes by id and keeps running work first', () => {
    const live = { ...DONE, status: 'running' as const };
    const merged = mergeResearchRuns([DONE, OLDER], [live]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].status, 'running');
  });

  test('meta reads as instrumentation, not prose', () => {
    assert.equal(researchRunMeta(DONE), '11 sources · 3 rounds · 2:48');
    assert.equal(researchRunMeta({ ...DONE, sourceCount: 1, rounds: 1, duration: '' }), '1 source · 1 round');
  });

  test('raw engine seconds are read back as a clock', () => {
    // server/research/engine.js persists Duration as `${elapsed.toFixed(1)}s`.
    assert.equal(formatRunDuration('476.8s'), '7:57');
    assert.equal(formatRunDuration('9s'), '0:09');
    assert.equal(formatRunDuration('2:48'), '2:48');
    assert.equal(formatRunDuration(''), '');
    assert.equal(researchRunMeta({ ...DONE, duration: '476.8s' }), '11 sources · 3 rounds · 7:57');
  });
});
