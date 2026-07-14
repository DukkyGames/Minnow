/**
 * Composer external file drop — one attachment per OS file, not one per nested target.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { clearAttachments, getPendingAttachments } from '../../src/attachments/store.ts';
import { initComposerDrop } from '../../src/ui/composer-drop.ts';

function setupNestedCodeComposerDom(): { input: HTMLTextAreaElement; window: Window } {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.File = window.File;
  globalThis.DragEvent = window.DragEvent;

  const inputBar = document.createElement('div');
  inputBar.className = 'input-bar';

  const composer = document.createElement('div');
  composer.className = 'input-bar-composer';

  const input = document.createElement('textarea');
  input.id = 'msgInput';

  composer.appendChild(input);
  inputBar.append(composer);
  document.body.appendChild(inputBar);

  return { input, window };
}

/** Minimal DataTransfer for drop simulation (happy-dom lacks full DnD APIs). */
function makeFileDropTransfer(file: File): DataTransfer {
  const files = Object.assign([file], {
    item: (index: number) => [file][index] ?? null,
  });
  return {
    types: ['Files'],
    files: files as unknown as FileList,
    getData: () => '',
    dropEffect: 'none',
    effectAllowed: 'all',
  } as DataTransfer;
}

describe('initComposerDrop', () => {
  let testWindow: Window | undefined;

  afterEach(() => {
    clearAttachments();
    document.body.replaceChildren();
    testWindow?.close();
    testWindow = undefined;
  });

  it('adds one attachment when an external file is dropped on a nested composer', async () => {
    const { input, window } = setupNestedCodeComposerDom();
    testWindow = window;
    initComposerDrop();

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const transfer = makeFileDropTransfer(file);
    const event = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });

    input.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(getPendingAttachments().length, 1);
    assert.equal(getPendingAttachments()[0]?.name, 'note.txt');
  });
});
