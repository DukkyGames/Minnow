/**
 * Project file tree → composer path links (not text attachment chips).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { insertWorkspacePathInComposer } from '../src/attachments/workspace-ref.ts';
import { getPendingAttachments, clearAttachments } from '../src/attachments/store.ts';
import { isImageFilePath } from '../src/attachments/image-path.ts';

function setupComposerDom(): HTMLTextAreaElement {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;

  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);
  return input;
}

describe('insertWorkspacePathInComposer', () => {
  afterEach(() => {
    clearAttachments();
    document.body.replaceChildren();
  });

  it('appends a normalized project-relative path', () => {
    const input = setupComposerDom();
    insertWorkspacePathInComposer('src\\foo.ts');
    assert.equal(input.value, 'src/foo.ts');
  });

  it('dedupes when the path is already in the composer', () => {
    const input = setupComposerDom();
    input.value = 'See src/foo.ts';
    insertWorkspacePathInComposer('src/foo.ts');
    assert.equal(input.value, 'See src/foo.ts');
  });
});

describe('workspace path vs image routing', () => {
  it('classifies png as image and ts as text', () => {
    assert.equal(isImageFilePath('assets/logo.png'), true);
    assert.equal(isImageFilePath('src/bar.ts'), false);
  });
});
