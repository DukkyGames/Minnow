import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { syncSecondaryPreviewUrlInput } from '../../src/ui/preview-secondary-slot.ts';

async function setupDom(): Promise<void> {
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

  document.body.innerHTML = `
    <input id="previewUrlInputSecondary" type="text" value="" />
  `;
}

describe('preview secondary slot', () => {
  beforeEach(async () => {
    await setupDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('syncSecondaryPreviewUrlInput maps workspace and url sources', () => {
    syncSecondaryPreviewUrlInput({ kind: 'workspace', path: 'src/index.html' });
    assert.equal(
      (document.getElementById('previewUrlInputSecondary') as HTMLInputElement).value,
      'src/index.html',
    );

    syncSecondaryPreviewUrlInput({ kind: 'url', url: 'https://example.com' });
    assert.equal(
      (document.getElementById('previewUrlInputSecondary') as HTMLInputElement).value,
      'https://example.com',
    );

    syncSecondaryPreviewUrlInput(null);
    assert.equal(
      (document.getElementById('previewUrlInputSecondary') as HTMLInputElement).value,
      '',
    );
  });
});
