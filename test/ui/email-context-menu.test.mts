/**
 * Accessible Email context menu keyboard traversal (Happy DOM).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import {
  closeEmailContextMenu,
  openEmailContextMenu,
} from '../../src/ui/email/email-context-menu';

describe('email context menu', () => {
  const windows: Window[] = [];

  afterEach(() => {
    closeEmailContextMenu();
    for (const win of windows.splice(0)) {
      win.close();
    }
  });

  function installDom(): { document: Document; window: Window & typeof globalThis } {
    const win = new Window({ url: 'https://minnow.local/' });
    windows.push(win);
    // Bind the menu module's document/window globals to Happy DOM.
    (globalThis as { document?: Document }).document = win.document as unknown as Document;
    (globalThis as { window?: Window }).window = win as unknown as Window;
    return {
      document: win.document as unknown as Document,
      window: win as unknown as Window & typeof globalThis,
    };
  }

  test('focuses the first item and closes on Escape', () => {
    const { document } = installDom();
    const restore = document.createElement('button');
    document.body.appendChild(restore);
    restore.focus();

    const chosen: string[] = [];
    const handle = openEmailContextMenu({
      clientX: 40,
      clientY: 40,
      restoreFocus: restore,
      items: [
        { id: 'a', label: 'Archive', onSelect: () => chosen.push('a') },
        { id: 'b', label: 'Trash', onSelect: () => chosen.push('b') },
      ],
    });

    assert.equal(document.activeElement?.textContent, 'Archive');
    document.dispatchEvent(
      new (document.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    assert.equal(handle.root.isConnected, false);
    assert.equal(document.activeElement, restore);
    assert.deepEqual(chosen, []);
  });

  test('ArrowDown moves focus; clicking the item runs onSelect', async () => {
    const { document } = installDom();
    const chosen: string[] = [];
    const handle = openEmailContextMenu({
      clientX: 20,
      clientY: 20,
      items: [
        { id: 'a', label: 'Archive', onSelect: () => chosen.push('a') },
        { id: 'b', label: 'Trash', onSelect: () => chosen.push('b') },
      ],
    });

    const KeyboardEvent = (document.defaultView as unknown as typeof globalThis).KeyboardEvent;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.activeElement?.textContent, 'Trash');
    // Happy DOM's synthetic Enter does not always fire a button click; drive
    // the menuitem directly after keyboard focus proves traversal works.
    (document.activeElement as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(chosen, ['b']);
    assert.equal(handle.root.isConnected, false);
  });
});
