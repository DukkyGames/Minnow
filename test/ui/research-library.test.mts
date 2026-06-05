import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { renderResearchLibrary } from '../../src/research/library.ts';

const MOCK_ITEMS = [
  {
    id: 'rs-aaaaaaaaaaaa',
    query: 'Best local LLM stacks',
    status: 'done' as const,
    category: 'comparison',
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

  test('renders mock library rows', async () => {
    const mount = document.getElementById('researchLibraryMount') as HTMLElement;
    await renderResearchLibrary({
      mount,
      onOpenDetail: () => {},
      onOpenReport: () => {},
      onDiscuss: () => {},
      onRefine: () => {},
    });
    const list = mount.querySelector('#researchLibraryList');
    assert.ok(list);
    assert.match(list?.innerHTML ?? '', /Best local LLM stacks/);
    assert.match(list?.innerHTML ?? '', /data-research-id="rs-aaaaaaaaaaaa"/);
    const empty = mount.querySelector('#researchLibraryEmpty');
    assert.ok(empty?.classList.contains('hidden'));
  });
});
