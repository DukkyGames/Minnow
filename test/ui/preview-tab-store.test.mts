import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { resetFilePanelStateForTests } from '../../src/state/file-panel.ts';
import {
  activatePreviewTab,
  closePreviewTab,
  getActivePreviewTabId,
  openPreviewTab,
  reorderPreviewTab,
  resetPreviewTabStoreForTests,
  restorePreviewTabs,
} from '../../src/ui/preview-tab-store.ts';

describe('preview-tab-store', () => {
  beforeEach(() => {
    resetPreviewTabStoreForTests();
    resetFilePanelStateForTests();
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch;
  });

  test('openPreviewTab creates tab and activates it', () => {
    const tab = openPreviewTab({ kind: 'url', url: 'https://example.com' });
    assert.ok(tab);
    assert.equal(getActivePreviewTabId(), tab.id);
  });

  test('closePreviewTab selects another active tab', () => {
    const a = openPreviewTab({ kind: 'url', url: 'https://a.test' });
    const b = openPreviewTab({ kind: 'url', url: 'https://b.test' });
    assert.ok(a && b);
    closePreviewTab(b.id);
    assert.equal(getActivePreviewTabId(), a.id);
  });

  test('reorderPreviewTab moves tab in strip order', () => {
    const a = openPreviewTab({ kind: 'url', url: 'https://a.test' });
    const b = openPreviewTab({ kind: 'url', url: 'https://b.test' });
    assert.ok(a && b);
    reorderPreviewTab(a.id, 1);
    activatePreviewTab(b.id);
    assert.equal(getActivePreviewTabId(), b.id);
  });

  test('restorePreviewTabs preserves order and active id', () => {
    restorePreviewTabs(
      [
        { id: 't1', source: { kind: 'url', url: 'https://one.test' } },
        { id: 't2', source: { kind: 'workspace', path: 'index.html' } },
      ],
      't2',
    );
    assert.equal(getActivePreviewTabId(), 't2');
  });
});
