/**
 * Composer tools popover: toggle visibility on toolbar button click (MIN-503).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

describe('composer tools popover', () => {
  test('clicking the Code composer tools button opens the popover', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <div class="composer-controls">
        <div class="composer-controls__trail">
          <div class="composer-tools-anchor">
            <button type="button" id="btnComposerTools" aria-expanded="false">Tools</button>
            <div id="composerToolsPopover" class="composer-tools-popover hidden" role="dialog"></div>
          </div>
        </div>
      </div>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { initComposerToolsPopover } = await import('../../src/ui/composer-tools-popover.ts');
      initComposerToolsPopover();

      const button = doc.getElementById('btnComposerTools') as HTMLButtonElement;
      const popover = doc.getElementById('composerToolsPopover') as HTMLElement;

      assert.ok(popover.classList.contains('hidden'));
      button.click();
      assert.ok(!popover.classList.contains('hidden'));
      assert.equal(button.getAttribute('aria-expanded'), 'true');

      button.click();
      assert.ok(popover.classList.contains('hidden'));
      assert.equal(button.getAttribute('aria-expanded'), 'false');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('composer tools popover CSS escapes composer-controls__trail overflow clipping', () => {
    const css = readFileSync(join(repoRoot, 'src/styles/composer-tools-popover.css'), 'utf8');
    assert.match(css, /\.composer-controls__trail:has\(\.composer-tools-popover:not\(\.hidden\)\)/);
    assert.match(css, /overflow:\s*visible/);
  });
});
