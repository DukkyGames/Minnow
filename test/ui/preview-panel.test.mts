import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { workspacePreviewUrl } from '../../src/ui/preview-panel.ts';

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
});
