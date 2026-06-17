import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function flushAnimationFrames() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function setupDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLDivElement = window.HTMLDivElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLUListElement = window.HTMLUListElement;
  globalThis.HTMLOListElement = window.HTMLOListElement;
  globalThis.Node = window.Node;
  globalThis.requestAnimationFrame = (cb) => window.requestAnimationFrame(cb);
  document.body.innerHTML = '<span id="sDot"></span><span id="sText"></span>';

  const browseDir = '/projects/parent';
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.includes('/api/workspace/browse')) {
      const q = new URL(path, 'http://127.0.0.1').searchParams.get('path') ?? '';
      if (!q) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            path: '',
            parent: null,
            entries: [{ name: 'parent', path: browseDir }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: browseDir,
          parent: '',
          entries: [],
        }),
      };
    }
    if (path.includes('/api/workspace/mkdir') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          path: `${body.parentPath}/${body.name}`,
          name: body.name,
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  return window;
}

const {
  isWorkspaceFolderPickerOpen,
  openWorkspaceFolderPicker,
  resetWorkspaceFolderPickerForTests,
} = await import('../../src/ui/workspace-folder-picker.ts');

describe('workspace-folder-picker', { concurrency: false }, () => {
  test('new folder input receives focus and accepts a custom name', async () => {
    const win = setupDom();
    resetWorkspaceFolderPickerForTests();

    const pickerPromise = openWorkspaceFolderPicker({ initialPath: '/projects/parent' });
    await flushPromises();
    assert.equal(isWorkspaceFolderPickerOpen(), true);

    const newFolderBtn = document.querySelector('[data-ws-picker-new-folder]');
    const input = document.querySelector('[data-ws-picker-new-folder-input]');
    assert.ok(newFolderBtn);
    assert.ok(input);

    newFolderBtn.click();
    await flushAnimationFrames();
    assert.equal(document.activeElement, input);
    assert.equal(input.value, 'New folder');

    input.value = 'my-workspace';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    assert.equal(input.value, 'my-workspace');

    document.querySelector('[data-ws-picker-cancel]')?.click();
    const result = await pickerPromise;
    assert.equal(result.cancelled, true);
    resetWorkspaceFolderPickerForTests();
  });

  test('Escape closes new folder panel before dismissing the picker', async () => {
    const win = setupDom();
    resetWorkspaceFolderPickerForTests();

    void openWorkspaceFolderPicker({ initialPath: '/projects/parent' });
    await flushPromises();

    document.querySelector('[data-ws-picker-new-folder]')?.click();
    await flushAnimationFrames();

    const panel = document.querySelector('[data-ws-picker-new-folder-panel]');
    assert.ok(panel);
    assert.equal(panel.hidden, false);

    document.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );

    assert.equal(panel.hidden, true);
    assert.equal(isWorkspaceFolderPickerOpen(), true);

    document.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(isWorkspaceFolderPickerOpen(), false);
    resetWorkspaceFolderPickerForTests();
  });

  test('reuses existing overlay DOM and still wires listeners after reset', async () => {
    setupDom();
    resetWorkspaceFolderPickerForTests();

    void openWorkspaceFolderPicker({ initialPath: '/projects/parent' });
    await flushPromises();
    const overlay = document.getElementById('workspaceFolderPickerOverlay');
    assert.ok(overlay);

    resetWorkspaceFolderPickerForTests();
    assert.equal(document.getElementById('workspaceFolderPickerOverlay'), null);

    void openWorkspaceFolderPicker({ initialPath: '/projects/parent' });
    await flushPromises();

    document.querySelector('[data-ws-picker-new-folder]')?.click();
    await flushAnimationFrames();
    const input = document.querySelector('[data-ws-picker-new-folder-input]');
    assert.equal(document.activeElement, input);
    resetWorkspaceFolderPickerForTests();
  });
});
