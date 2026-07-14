import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { mountWindowFrame } from '../../src/os/window-frame.ts';

describe('WindowFrame focus', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    win.document.body.innerHTML = `
      <div id="osStage" style="width:800px;height:600px;position:relative">
        <div id="osWindowsLayer"></div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('focus does not steal DOM focus from an input inside the window body', () => {
    const layer = document.getElementById('osWindowsLayer')!;
    const frame = mountWindowFrame(layer, {
      windowId: 'win-1',
      title: 'Settings',
      bounds: { x: 40, y: 40, width: 400, height: 300 },
    });

    const input = document.createElement('input');
    input.type = 'text';
    frame.body.appendChild(input);
    input.focus();
    assert.equal(document.activeElement, input);

    frame.focus();

    assert.equal(document.activeElement, input);
    assert.ok(frame.root.classList.contains('is-focused'));
  });

  test('focus moves to window chrome when no editable control is active', () => {
    const layer = document.getElementById('osWindowsLayer')!;
    const frame = mountWindowFrame(layer, {
      windowId: 'win-2',
      title: 'Models',
      bounds: { x: 20, y: 20, width: 360, height: 280 },
    });

    frame.focus();

    assert.equal(document.activeElement, frame.root);
    assert.ok(frame.root.classList.contains('is-focused'));
  });
});
