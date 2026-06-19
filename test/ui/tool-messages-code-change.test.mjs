/**
 * Tool result bubbles show GitHub-style +/− badges.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { renderToolCall, renderToolResult } = await import('../../src/ui/tool-messages.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<main id="chatArea"></main>';
  return window;
}

describe('renderToolResult codeChange badge', () => {
  /** @type {import('happy-dom').Window | undefined} */
  let window;

  afterEach(() => {
    window?.close();
    window = undefined;
  });

  test('shows + and − on success', () => {
    window = setupDom();
    const wrap = renderToolCall('save_file', { path: 'a.ts' });
    renderToolResult(wrap, 'Saved a.ts', undefined, undefined, {
      additions: 12,
      deletions: 3,
      path: 'a.ts',
    });
    const badge = wrap.querySelector('.tool-call-code-change');
    assert.ok(badge);
    assert.equal(badge.querySelector('.tool-call-code-change__add')?.textContent, '+12');
    assert.equal(badge.querySelector('.tool-call-code-change__del')?.textContent, '−3');
  });

  test('hides badge on error result', () => {
    window = setupDom();
    const wrap = renderToolCall('save_file', { path: 'a.ts' });
    renderToolResult(wrap, 'Error: denied', undefined, undefined, {
      additions: 5,
      deletions: 0,
    });
    assert.equal(wrap.querySelector('.tool-call-code-change'), null);
  });

  test('hides badge when stats are zero', () => {
    window = setupDom();
    const wrap = renderToolCall('move_file', {});
    renderToolResult(wrap, 'Moved', undefined, undefined, {
      additions: 0,
      deletions: 0,
    });
    assert.equal(wrap.querySelector('.tool-call-code-change'), null);
  });

  test('renders unified diff panel when diffLines present', () => {
    window = setupDom();
    const wrap = renderToolCall('save_file', { path: 'a.ts' });
    renderToolResult(wrap, 'Saved', undefined, undefined, {
      additions: 1,
      deletions: 1,
      path: 'a.ts',
      diffLines: [
        { type: 'remove', text: 'old' },
        { type: 'add', text: 'new' },
      ],
    });
    const panel = wrap.querySelector('.tool-call-diff');
    assert.ok(panel);
    assert.ok(panel.querySelector('.prompt-diff__line--remove'));
    assert.ok(panel.querySelector('.prompt-diff__line--add'));
  });
});

describe('renderToolCall display labels', () => {
  /** @type {import('happy-dom').Window | undefined} */
  let window;

  afterEach(() => {
    window?.close();
    window = undefined;
  });

  test('non-file tool uses human-readable label', () => {
    window = setupDom();
    const wrap = renderToolCall('web_search', {});
    const title = wrap.querySelector('.tool-call-title');
    assert.equal(title?.textContent, 'Web search');
  });

  test('unknown tool falls back to spaced snake_case', () => {
    window = setupDom();
    const wrap = renderToolCall('my_custom_tool', {});
    const title = wrap.querySelector('.tool-call-title');
    assert.equal(title?.textContent, 'my custom tool');
  });

  test('file card uses path basename as title', () => {
    window = setupDom();
    const wrap = renderToolCall('save_file', { path: 'src/wait-for-vite.mjs' });
    const title = wrap.querySelector('.tool-call-title');
    assert.equal(title?.textContent, 'wait-for-vite.mjs');
  });

  test('file card is open by default with file-card classes', () => {
    window = setupDom();
    const wrap = renderToolCall('save_file', { path: 'src/wait-for-vite.mjs' });
    const details = wrap.querySelector('.tool-call-details');
    assert.ok(wrap.classList.contains('tool-call-msg--file'));
    assert.ok(details?.classList.contains('tool-call-details--file'));
    assert.equal(details?.open, true);
  });

  test('file card shows diff on result', () => {
    window = setupDom();
    const wrap = renderToolCall('save_file', { path: 'src/wait-for-vite.mjs' });
    renderToolResult(wrap, 'Saved', undefined, undefined, {
      additions: 2,
      deletions: 1,
      path: 'src/wait-for-vite.mjs',
      diffLines: [
        { type: 'remove', text: 'old line' },
        { type: 'add', text: 'new line' },
      ],
    });
    const panel = wrap.querySelector('.tool-call-diff');
    assert.ok(panel);
    assert.equal(wrap.querySelector('.tool-call-title')?.textContent, 'wait-for-vite.mjs');
    const badge = wrap.querySelector('.tool-call-code-change');
    assert.equal(badge?.querySelector('.tool-call-code-change__add')?.textContent, '+2');
    assert.equal(badge?.querySelector('.tool-call-code-change__del')?.textContent, '−1');
  });
});
