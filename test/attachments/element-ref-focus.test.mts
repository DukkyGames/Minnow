/**
 * elementRef composer focus should use the active composer surface, not hardcoded #msgInput.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
  globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.window = window as unknown as Window & typeof globalThis.window;

  const codeInput = document.createElement('textarea');
  codeInput.id = 'msgInput';
  document.body.appendChild(codeInput);

  const desktopInput = document.createElement('textarea');
  desktopInput.id = 'desktopInput';
  document.body.appendChild(desktopInput);

  const preview = document.createElement('div');
  preview.id = 'attachPreview';
  preview.className = 'hidden';
  document.body.appendChild(preview);

  const desktopPreview = document.createElement('div');
  desktopPreview.id = 'desktopAttachPreview';
  desktopPreview.className = 'hidden';
  document.body.appendChild(desktopPreview);
}

afterEach(async () => {
  const { clearAttachments } = await import('../../src/attachments/store.ts');
  clearAttachments();
  document.body.innerHTML = '';
});

describe('focusComposerInput via addElementRefToComposer', () => {
  it('focuses the registered active composer surface (desktop), not #msgInput', async () => {
    setupDom();

    const { registerComposerSurface } = await import('../../src/ui/composer-surface.ts');
    const desktopInput = document.getElementById('desktopInput') as HTMLTextAreaElement;
    const codeInput = document.getElementById('msgInput') as HTMLTextAreaElement;
    registerComposerSurface('desktop', { inputEl: desktopInput, sendBtnEl: null });

    // Force resolveComposerKey → desktop by registering and stubbing via desktop registry
    // when Code is not foreground: register under 'code' would win if code is foreground.
    // Prefer registering the surface that getActiveComposerSurface will pick — override code.
    registerComposerSurface('code', { inputEl: desktopInput, sendBtnEl: null });

    const { addElementRefToComposer } = await import('../../src/attachments/element-ref.ts');
    addElementRefToComposer({
      selector: 'button.cta',
      uid: 1,
      pageUrl: 'page.html',
      tagName: 'button',
      classList: ['cta'],
      outerHtmlPreview: '<button class="cta">Buy</button>',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      stylesDigest: 'font:14px',
    });

    assert.equal(document.activeElement, desktopInput);
    assert.notEqual(document.activeElement, codeInput);
  });
});
