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
});
