import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { createPickerTransport } from '../../src/design/element-picker.ts';

describe('design picker transport', () => {
  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    document.body.innerHTML = '<iframe id="previewFrame" title="preview"></iframe>';
    Object.assign(globalThis.window, { location: { origin: 'http://127.0.0.1:5173' } });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('electron transport when execJs is present and unwraps __execError', async () => {
    let seenExpr = '';
    Object.assign(globalThis.window, {
      minnow: {
        preview: {
          execJs: async (expr: string) => {
            seenExpr = expr;
            return { __execError: 'boom' };
          },
        },
      },
    });

    const transport = createPickerTransport();
    assert.equal(transport.mode, 'electron');
    assert.equal(transport.canReadGuest(), true);
    await assert.rejects(() => transport.eval('1 + 1'), /boom/);
    assert.equal(seenExpr, '1 + 1');
  });

  test('iframe transport when only #previewFrame exists', async () => {
    Object.assign(globalThis.window, { minnow: undefined });
    const frame = document.getElementById('previewFrame') as HTMLIFrameElement;
    const childWin = new Window();
    childWin.document.body.innerHTML = '<div id="x">ok</div>';
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: childWin,
    });

    const transport = createPickerTransport();
    assert.equal(transport.mode, 'iframe');
    assert.equal(transport.canReadGuest(), true);
    const result = await transport.eval('document.getElementById("x").textContent');
    assert.equal(result, 'ok');
  });

  test('canReadGuest is false for cross-origin iframe', () => {
    Object.assign(globalThis.window, { minnow: undefined });
    const frame = document.getElementById('previewFrame') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

    const transport = createPickerTransport();
    assert.equal(transport.mode, 'iframe');
    assert.equal(transport.canReadGuest(), false);
  });
});
