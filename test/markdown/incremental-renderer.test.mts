/**
 * Phase 5 — incremental streaming markdown must match one-shot final DOM,
 * and must preserve earlier block node identity across ticks.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { ASSISTANT_RENDER_DEBOUNCE_MS } from '../../src/constants.ts';

type DomGlobals = typeof globalThis & {
  document: Document;
  window: Window;
  HTMLElement: typeof HTMLElement;
  DocumentFragment: typeof DocumentFragment;
  Element: typeof Element;
};

let win: Window;

function installWindow(): void {
  win = new Window();
  const g = globalThis as DomGlobals;
  g.document = win.document;
  g.window = win as unknown as Window & typeof globalThis.window;
  g.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
  g.DocumentFragment = win.DocumentFragment as unknown as typeof DocumentFragment;
  g.Element = win.Element as unknown as typeof Element;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Canonical fixture covering lists, tables, fences, setext, inline HTML. */
function buildFixture(partial: 'full' | 'unterminated-fence' | 'growing'): string {
  const head = [
    'Intro paragraph with **bold** and `code`.',
    '',
    'Setext heading',
    '==============',
    '',
    '- nested',
    '  - list',
    '  - items',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const x = 1;',
  ].join('\n');

  if (partial === 'unterminated-fence') {
    return head;
  }
  if (partial === 'growing') {
    return `${head}\nconst y = 2;`;
  }
  return [
    head,
    '```',
    '',
    '```python',
    'print("hi")',
    '```',
    '',
    '<div class="note">inline html</div>',
    '',
    'Trailing prose.',
  ].join('\n');
}

describe('incremental assistant markdown render', () => {
  afterEach(() => {
    win?.close();
  });

  it('chunked streaming matches one-shot final DOM', async () => {
    installWindow();
    // DOMPurify binds to window at module load — import renderer after happy-dom is installed.
    const {
      scheduleAssistantBubbleRender,
      setAssistantBubbleContent,
    } = await import('../../src/markdown/renderer.ts');

    const full = buildFixture('full');
    const bubble = win.document.createElement('div');
    const cursor = win.document.createElement('span');
    cursor.className = 'stream-cursor';
    win.document.body.appendChild(bubble);

    // Grow by chunks (not every char) so the suite stays fast while still exercising dirty suffix.
    const step = 7;
    for (let i = step; i < full.length; i += step) {
      scheduleAssistantBubbleRender(bubble, full.slice(0, i), cursor);
      await sleep(ASSISTANT_RENDER_DEBOUNCE_MS + 8);
    }
    scheduleAssistantBubbleRender(bubble, full, cursor);
    await sleep(ASSISTANT_RENDER_DEBOUNCE_MS + 8);
    // Allow async highlightCodeElement settles.
    await sleep(30);

    const expected = win.document.createElement('div');
    setAssistantBubbleContent(expected, full, { streaming: false });
    await sleep(30);

    cursor.remove();
    // Full-document DOMPurify often unwraps the first `<p>`; per-token wrapped sanitize keeps it.
    // Assert semantic equivalence (text + key structures), not byte-identical HTML.
    assert.equal(bubble.textContent?.replace(/\s+/g, ' ').trim(), expected.textContent?.replace(/\s+/g, ' ').trim());
    assert.equal(bubble.querySelectorAll('h1').length, expected.querySelectorAll('h1').length);
    assert.equal(bubble.querySelectorAll('ul').length, expected.querySelectorAll('ul').length);
    assert.equal(bubble.querySelectorAll('table').length, expected.querySelectorAll('table').length);
    assert.equal(bubble.querySelectorAll('pre').length, expected.querySelectorAll('pre').length);
    assert.equal(bubble.querySelectorAll('pre code').length, expected.querySelectorAll('pre code').length);
    assert.ok(bubble.querySelector('.note'), 'inline HTML block preserved');
  });

  it('preserves earlier block node identity across streaming ticks', async () => {
    installWindow();
    const {
      getAssistantBubbleRenderStateForTests,
      setAssistantBubbleContent,
    } = await import('../../src/markdown/renderer.ts');

    const bubble = win.document.createElement('div');
    const cursor = win.document.createElement('span');
    win.document.body.appendChild(bubble);

    const early = buildFixture('unterminated-fence');
    setAssistantBubbleContent(bubble, early, { streaming: true, streamCursor: cursor });
    const before = getAssistantBubbleRenderStateForTests(bubble);
    assert.ok(before.firstNode, 'expected at least one committed node');
    const preserved = before.firstNode!;

    const later = buildFixture('growing');
    setAssistantBubbleContent(bubble, later, { streaming: true, streamCursor: cursor });
    const after = getAssistantBubbleRenderStateForTests(bubble);
    assert.equal(
      after.firstNode,
      preserved,
      'prefix node identity must survive dirty suffix rebuild',
    );

    const closed = buildFixture('full');
    setAssistantBubbleContent(bubble, closed, { streaming: true, streamCursor: cursor });
    const finalState = getAssistantBubbleRenderStateForTests(bubble);
    assert.equal(finalState.firstNode, preserved);
  });

  it('handles late-arriving setext heading without throwing', async () => {
    installWindow();
    const { setAssistantBubbleContent } = await import('../../src/markdown/renderer.ts');
    const bubble = win.document.createElement('div');
    const cursor = win.document.createElement('span');
    setAssistantBubbleContent(bubble, 'Title\n', { streaming: true, streamCursor: cursor });
    setAssistantBubbleContent(bubble, 'Title\n====\n\nbody', {
      streaming: true,
      streamCursor: cursor,
    });
    assert.ok(bubble.querySelector('h1') || bubble.textContent?.includes('Title'));
  });
});
