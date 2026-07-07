import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  createElementPicker,
  PICKER_DISABLE_SCRIPT,
  PICKER_ENABLE_SCRIPT,
  PICKER_POLL_SCRIPT,
  type PickerTransport,
  type PickedElement,
} from '../../src/design/element-picker.ts';
import { DEFAULT_FILE_PANEL_STATE, resetFilePanelStateForTests, setFilePanelState } from '../../src/state/file-panel.ts';

const cannedPick: PickedElement = {
  uid: 5,
  cssSelector: '#hero',
  tagName: 'section',
  classList: ['hero'],
  outerHTMLPreview: '<section id="hero" class="hero">',
  boundingRect: { x: 1, y: 2, width: 300, height: 200 },
  devicePixelRatio: 2,
};

function makeTransport(
  impl: Partial<PickerTransport> & Pick<PickerTransport, 'eval'>,
): PickerTransport {
  return {
    mode: impl.mode ?? 'electron',
    eval: impl.eval,
    canReadGuest: impl.canReadGuest ?? (() => true),
  };
}

describe('design picker payload', () => {
  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    document.body.innerHTML = '<iframe id="previewFrame"></iframe>';
    Object.assign(globalThis.window, { location: { origin: 'http://127.0.0.1:5173' } });
    resetFilePanelStateForTests();
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'workspace', path: 'index.html' },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('enable polls guest and forwards full PickedElement', async () => {
    const evalCalls: string[] = [];
    let pollCount = 0;
    const transport = makeTransport({
      async eval(expr) {
        evalCalls.push(expr);
        if (expr === PICKER_ENABLE_SCRIPT) return { ok: true };
        if (expr === PICKER_POLL_SCRIPT) {
          pollCount += 1;
          return pollCount === 1 ? cannedPick : null;
        }
        return null;
      },
    });

    const picks: PickedElement[] = [];
    const picker = createElementPicker({
      transport,
      onPick: (picked) => picks.push(picked),
    });

    await picker.enable();
    assert.equal(picker.isEnabled(), true);
    assert.ok(evalCalls.some((c) => c === PICKER_ENABLE_SCRIPT));

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(picks.length, 1);
    assert.deepEqual(picks[0], cannedPick);

    await picker.disable();
    picker.destroy();
  });

  test('disable stops polling and runs DISABLE_SCRIPT', async () => {
    const evalCalls: string[] = [];
    const transport = makeTransport({
      async eval(expr) {
        evalCalls.push(expr);
        if (expr === PICKER_ENABLE_SCRIPT) return { ok: true };
        if (expr === PICKER_POLL_SCRIPT) return cannedPick;
        if (expr === PICKER_DISABLE_SCRIPT) return { ok: true };
        return null;
      },
    });

    const picks: PickedElement[] = [];
    const picker = createElementPicker({
      transport,
      onPick: (picked) => picks.push(picked),
    });

    await picker.enable();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const countAfterEnable = picks.length;

    await picker.disable();
    assert.equal(picker.isEnabled(), false);
    assert.ok(evalCalls.includes(PICKER_DISABLE_SCRIPT));

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(picks.length, countAfterEnable);
    picker.destroy();
  });
});
