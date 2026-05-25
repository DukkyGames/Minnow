import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

describe('prompt-diff-panel', () => {
  test('compare toggle reveals diff lines', async () => {
    const win = new Window();
    globalThis.document = win.document;
    globalThis.localStorage = win.localStorage;
    globalThis.HTMLElement = win.HTMLElement;

    const { mountPromptDiffControls } = await import('../../src/ui/prompt-diff-panel.ts');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const controls = mountPromptDiffControls(host, {
      getBaseline: () => 'line one\nline two',
      getCurrent: () => 'line one\nline three',
    });

    const compareCb = host.querySelector('input[type="checkbox"]');
    assert.ok(compareCb);
    compareCb.checked = true;
    compareCb.dispatchEvent(new win.Event('change'));

    controls.refresh();
    const diffLine = host.querySelector('.prompt-diff__line--add');
    assert.ok(diffLine, 'expected an added diff line in the panel');
  });
});
