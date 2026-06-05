import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolvePreviewLoadUrl, workspacePreviewUrl } from '../../src/ui/preview-panel.ts';

describe('preview panel helpers', () => {
  test('workspacePreviewUrl encodes path segments', () => {
    assert.equal(workspacePreviewUrl('index.html'), '/api/preview/file/index.html');
    assert.equal(
      workspacePreviewUrl('docs/demo page.html'),
      '/api/preview/file/docs/demo%20page.html',
    );
  });

  test('workspacePreviewUrl adds cache-bust query', () => {
    assert.equal(
      workspacePreviewUrl('app.js', 12345),
      '/api/preview/file/app.js?v=12345',
    );
  });

  test('resolvePreviewLoadUrl absolutizes root-relative API paths for Electron', () => {
    const prev = globalThis.window;
    globalThis.window = { location: { origin: 'http://127.0.0.1:5173' } } as Window & typeof globalThis;
    try {
      assert.equal(
        resolvePreviewLoadUrl({
          kind: 'url',
          url: '/api/research/report/rs-24552c627990',
        }),
        'http://127.0.0.1:5173/api/research/report/rs-24552c627990',
      );
      assert.equal(
        resolvePreviewLoadUrl({ kind: 'url', url: 'https://example.com/page' }),
        'https://example.com/page',
      );
    } finally {
      globalThis.window = prev;
    }
  });
});
