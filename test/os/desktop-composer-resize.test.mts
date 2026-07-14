import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  DESKTOP_COMPOSER_MAX_LINES,
  autoResizeDesktopComposer,
} from '../../src/os/desktop-composer-resize.ts';
import { installHappyDomGlobals, prepareDesktopComposerField, stubTextareaScrollHeight } from './dom-helpers.mts';

describe('desktop composer resize', () => {
  let win: import('happy-dom').Window;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window({ innerHeight: 800 });
    installHappyDomGlobals(win);

    win.document.body.innerHTML = `
      <div class="mn-os-desktop-input-row">
        <div class="mn-os-desktop-input-wrap">
          <textarea id="desktopInput" class="mn-os-desktop-field" rows="1"></textarea>
        </div>
      </div>
    `;
    prepareDesktopComposerField(
      win.document.getElementById('desktopInput') as HTMLTextAreaElement,
    );
  });

  afterEach(() => {
    win.close();
  });

  test('expands height for multiple lines', () => {
    const field = win.document.getElementById('desktopInput') as HTMLTextAreaElement;
    field.value = 'one line';
    stubTextareaScrollHeight(field, 18);
    autoResizeDesktopComposer(field);
    const singleLine = Number.parseInt(field.style.height, 10);

    field.value = 'line one\nline two\nline three';
    stubTextareaScrollHeight(field, 28);
    autoResizeDesktopComposer(field);

    assert.ok(
      Number.parseInt(field.style.height, 10) > singleLine,
      `expected growth beyond ${singleLine}px, got ${field.style.height}`,
    );
    assert.equal(field.style.overflowY, 'hidden');
    assert.equal(field.classList.contains('mn-os-desktop-field--scrollable'), false);
  });

  test('scrolls after eight lines', () => {
    const field = win.document.getElementById('desktopInput') as HTMLTextAreaElement;
    const lines = Array.from({ length: DESKTOP_COMPOSER_MAX_LINES + 2 }, (_, i) => `line ${i + 1}`);
    field.value = lines.join('\n');
    // Exceeds max height from lineHeight 1.35 × 8 lines + 20px padding.
    stubTextareaScrollHeight(field, 80);
    autoResizeDesktopComposer(field);

    assert.equal(field.style.overflowY, 'auto');
    assert.equal(field.classList.contains('mn-os-desktop-field--scrollable'), true);
    assert.ok(Number.parseInt(field.style.height, 10) > 0);
  });
});
