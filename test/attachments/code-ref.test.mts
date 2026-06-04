/**
 * Editor selection code-reference attachments.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import {
  addCodeReferenceToComposer,
  codeRefHistoryBlock,
  formatCodeRefLabel,
} from '../../src/attachments/code-ref.ts';
import {
  clearAttachments,
  getPendingAttachments,
} from '../../src/attachments/store.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);

  const preview = document.createElement('div');
  preview.id = 'attachPreview';
  preview.className = 'hidden';
  document.body.appendChild(preview);
}

describe('codeRefHistoryBlock', () => {
  it('serializes path and line range', () => {
    const block = codeRefHistoryBlock('src/a.ts', 10, 12, 'const x = 1;');
    assert.match(block, /^<code-ref path="src\/a.ts" start="10" end="12">/);
    assert.match(block, /const x = 1;\n<\/code-ref>$/);
  });
});

describe('formatCodeRefLabel', () => {
  it('uses basename and line span', () => {
    assert.equal(formatCodeRefLabel('src/index.html', 15, 36), 'index.html L15-36');
    assert.equal(formatCodeRefLabel('foo.ts', 4, 4), 'foo.ts L4');
  });
});

describe('addCodeReferenceToComposer', () => {
  afterEach(() => {
    clearAttachments();
    document.body.replaceChildren();
  });

  it('queues a codeRef attachment', () => {
    setupDom();
    addCodeReferenceToComposer({
      workspacePath: 'src/foo.ts',
      startLine: 1,
      endLine: 3,
      text: 'line one',
    });
    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'codeRef');
    assert.equal(pending[0].workspacePath, 'src/foo.ts');
    assert.equal(pending[0].lineStart, 1);
    assert.equal(pending[0].lineEnd, 3);
    assert.equal(pending[0].text, 'line one');
  });

  it('dedupes identical path and range', () => {
    setupDom();
    addCodeReferenceToComposer({
      workspacePath: 'src/foo.ts',
      startLine: 5,
      endLine: 7,
      text: 'a',
    });
    addCodeReferenceToComposer({
      workspacePath: 'src/foo.ts',
      startLine: 5,
      endLine: 7,
      text: 'b',
    });
    assert.equal(getPendingAttachments().length, 1);
  });
});
