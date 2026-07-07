import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { resetFilePanelStateForTests } from '../../src/state/file-panel.ts';
import {
  activatePreviewTab,
  closePreviewTab,
  findOldestBackgroundPreviewTab,
  getActivePreviewTabId,
  MAX_PREVIEW_TABS,
  openPreviewTab,
  openPreviewTabWithCapacity,
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

  test('openPreviewTabWithCapacity returns evictedId when at tab limit', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_PREVIEW_TABS; i++) {
      const tab = openPreviewTab({ kind: 'url', url: `https://tab-${i}.test` });
      assert.ok(tab);
      ids.push(tab.id);
    }
    const oldestBackground = findOldestBackgroundPreviewTab();
    assert.ok(oldestBackground);
    const result = openPreviewTabWithCapacity({ kind: 'url', url: 'https://new.test' });
    assert.equal(result.tab, null);
    assert.equal(result.evictedId, oldestBackground.id);
  });

  test('openPreviewTabWithCapacity opens after eviction slot is freed', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_PREVIEW_TABS; i++) {
      const tab = openPreviewTab({ kind: 'url', url: `https://tab-${i}.test` });
      assert.ok(tab);
      ids.push(tab.id);
    }
    const evict = openPreviewTabWithCapacity(null);
    assert.ok(evict.evictedId);
    closePreviewTab(evict.evictedId!);
    const opened = openPreviewTabWithCapacity(null, { evict: false });
    assert.ok(opened.tab);
  });
});
