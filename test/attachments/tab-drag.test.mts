/**
 * Editor / browser tab drag payloads for chat link chips (MIN-630).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  PREVIEW_TAB_MIME,
  VIEWER_TAB_MIME,
  hasTabDrag,
  parseTabDragData,
  resetTabDragForTests,
  setPreviewTabDragData,
  setViewerTabDragData,
} from '../../src/attachments/tab-drag.ts';

function fakeTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
}

describe('tab-drag payloads', () => {
  afterEach(() => {
    resetTabDragForTests();
  });

  it('round-trips a file tab payload', () => {
    const transfer = fakeTransfer();
    const payload = setViewerTabDragData(transfer, {
      path: 'src/ui/composer-drop.ts',
      label: 'composer-drop.ts',
    });
    assert.deepEqual(payload, {
      kind: 'file',
      path: 'src/ui/composer-drop.ts',
      label: 'composer-drop.ts',
    });
    assert.equal(hasTabDrag(transfer), true);
    assert.deepEqual(parseTabDragData(transfer), payload);
    assert.ok(transfer.types.includes(VIEWER_TAB_MIME));
  });

  it('round-trips a browser URL tab payload', () => {
    const transfer = fakeTransfer();
    const payload = setPreviewTabDragData(transfer, {
      id: 'tab-1',
      title: 'Example',
      source: { kind: 'url', url: 'https://example.com/path' },
    });
    assert.deepEqual(payload, {
      kind: 'url',
      url: 'https://example.com/path',
      label: 'Example',
    });
    assert.equal(hasTabDrag(transfer), true);
    assert.deepEqual(parseTabDragData(transfer), payload);
    assert.ok(transfer.types.includes(PREVIEW_TAB_MIME));
  });

  it('treats a workspace preview tab as a file link', () => {
    const transfer = fakeTransfer();
    const payload = setPreviewTabDragData(transfer, {
      id: 'tab-2',
      title: 'index.html',
      source: { kind: 'workspace', path: 'index.html' },
    });
    assert.deepEqual(payload, {
      kind: 'file',
      path: 'index.html',
      label: 'index.html',
    });
  });

  it('does not mark an empty browser tab as linkable', () => {
    const transfer = fakeTransfer();
    const payload = setPreviewTabDragData(transfer, {
      id: 'tab-empty',
      title: 'New tab',
      source: null,
    });
    assert.equal(payload, null);
    assert.equal(hasTabDrag(transfer), false);
  });
});
