import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { renderResearchLibrary } from '../../src/research/library.ts';

const MOCK_ITEMS = [
  {
    id: 'rs-aaaaaaaaaaaa',
    query: 'Best local LLM stacks',
    status: 'done' as const,
    category: 'market',
    sourceCount: 11,
    rounds: 3,
    duration: '2:48',
    startedAt: '2026-01-01T12:00:00.000Z',
    completedAt: '2026-01-01T12:30:00.000Z',
  },
];

describe('research library', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.confirm = () => true;
    document.body.innerHTML = '<div id="researchLibraryMount" class="research-library"></div>';
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/research/library')) {
        return new Response(JSON.stringify({ items: MOCK_ITEMS }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  test('renders mock library cards', async () => {
    const mount = document.getElementById('researchLibraryMount') as HTMLElement;
    await renderResearchLibrary({
      mount,
      onOpenDetail: () => {},
      onOpenReport: () => {},
      onDiscuss: () => {},
      onRefine: () => {},
    });
    const grid = mount.querySelector('#researchLibraryGrid');
    assert.ok(grid);
    assert.match(grid?.innerHTML ?? '', /Best local LLM stacks/);
    assert.match(grid?.innerHTML ?? '', /data-research-id="rs-aaaaaaaaaaaa"/);
    const empty = mount.querySelector('#researchLibraryEmpty');
    assert.ok(empty?.classList.contains('hidden'));
  });

  test('toolbar uses dr-field pattern for sort select', async () => {
    const mount = document.getElementById('researchLibraryMount') as HTMLElement;
    await renderResearchLibrary({
      mount,
      onOpenDetail: () => {},
      onOpenReport: () => {},
      onDiscuss: () => {},
      onRefine: () => {},
    });
    const sortWrap = mount.querySelector('#researchLibrarySort')?.closest('.dr-select');
    assert.ok(sortWrap, 'sort select should be wrapped in .dr-select');
    assert.ok(mount.querySelector('.dr-lib-field-sort .dr-flabel'));
    assert.ok(mount.querySelector('#researchLibraryArchived.dr-switch__input'));
  });

  test('card overflow menu raises z-index on the active card', async () => {
    const mount = document.getElementById('researchLibraryMount') as HTMLElement;
    await renderResearchLibrary({
      mount,
      onOpenDetail: () => {},
      onOpenReport: () => {},
      onDiscuss: () => {},
      onRefine: () => {},
    });
    const menuBtn = mount.querySelector('[data-action="menu"]') as HTMLButtonElement;
    assert.ok(menuBtn);
    menuBtn.click();
    const card = menuBtn.closest('.dr-lib-card') as HTMLElement;
    assert.ok(card?.classList.contains('is-menu-open'));
    assert.ok(card?.querySelector('.dr-lib-menu'));
  });
});
