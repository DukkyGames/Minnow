import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  DESKTOP_COMPOSER_MAX_LINES,
  autoResizeDesktopComposer,
} from '../../src/os/desktop-composer-resize.ts';

describe('desktop composer resize', () => {
  let win: import('happy-dom').Window;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      getComputedStyle: typeof getComputedStyle;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.getComputedStyle = win.getComputedStyle.bind(win);

    win.document.body.innerHTML = `
      <div class="mn-os-desktop-input-row">
        <div class="mn-os-desktop-input-wrap">
          <textarea id="desktopInput" class="mn-os-desktop-field" rows="1"></textarea>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    win.close();
  });

  test('expands height for multiple lines', () => {
    const field = win.document.getElementById('desktopInput') as HTMLTextAreaElement;
    const singleLine = field.offsetHeight;

    field.value = 'line one\nline two\nline three';
    autoResizeDesktopComposer(field);

    assert.ok(
      field.offsetHeight > singleLine,
      `expected growth beyond ${singleLine}px, got ${field.offsetHeight}px`,
    );
    assert.equal(field.style.overflowY, 'hidden');
    assert.equal(field.classList.contains('mn-os-desktop-field--scrollable'), false);
  });

  test('scrolls after eight lines', () => {
    const field = win.document.getElementById('desktopInput') as HTMLTextAreaElement;
    const lines = Array.from({ length: DESKTOP_COMPOSER_MAX_LINES + 2 }, (_, i) => `line ${i + 1}`);
    field.value = lines.join('\n');
    autoResizeDesktopComposer(field);

    assert.equal(field.style.overflowY, 'auto');
    assert.equal(field.classList.contains('mn-os-desktop-field--scrollable'), true);
    assert.ok(field.offsetHeight > 0);
  });
});
