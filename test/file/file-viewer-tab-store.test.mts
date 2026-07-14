import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { resetFilePanelStateForTests } from '../../src/state/file-panel.ts';
import {
  activateViewerTab,
  clearAllViewerTabs,
  closeViewerTabsUnderAncestor,
  getActiveViewerTabPath,
  getOpenViewerTabPaths,
  openViewerTab,
  removeViewerTab,
  reorderViewerTab,
  resetViewerTabStoreForTests,
  restoreWorkspaceViewerTabs,
  retargetViewerTab,
  serializeWorkspaceViewerTabs,
} from '../../src/ui/file-viewer-tab-store.ts';

describe('file-viewer-tab-store', () => {
  beforeEach(() => {
    resetViewerTabStoreForTests();
    resetFilePanelStateForTests();
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch;
  });

  test('openTab focuses existing workspace path without duplicate', async () => {
    const first = await openViewerTab('src/a.ts', { skipUnsavedGuard: true });
    assert.ok(first);
    assert.equal(first.focusedExisting, false);
    await openViewerTab('src/b.ts', { skipUnsavedGuard: true });
    const second = await openViewerTab('src/a.ts', { skipUnsavedGuard: true });
    assert.ok(second);
    assert.equal(second.focusedExisting, true);
    assert.equal(getOpenViewerTabPaths().length, 2);
    assert.equal(getActiveViewerTabPath(), 'src/a.ts');
  });

  test('close last tab clears active path', async () => {
    await openViewerTab('readme.md', { skipUnsavedGuard: true });
    removeViewerTab('readme.md');
    assert.equal(getActiveViewerTabPath(), null);
    assert.deepEqual(getOpenViewerTabPaths(), []);
  });

  test('retargetTab updates path key', async () => {
    await openViewerTab('old/name.ts', { skipUnsavedGuard: true });
    retargetViewerTab('old/name.ts', 'new/name.ts');
    assert.deepEqual(getOpenViewerTabPaths(), ['new/name.ts']);
    assert.equal(getActiveViewerTabPath(), 'new/name.ts');
  });

  test('serializeWorkspaceTabs excludes attachments', async () => {
    await openViewerTab('src/index.ts', { skipUnsavedGuard: true });
    await openViewerTab('.minnow/attachments/snap.txt', {
      skipUnsavedGuard: true,
      kind: 'attachment',
      content: 'hi',
    });
    assert.deepEqual(serializeWorkspaceViewerTabs(), ['src/index.ts']);
  });

  test('restoreWorkspaceViewerTabs preserves order and active', () => {
    restoreWorkspaceViewerTabs(['b.ts', 'a.ts', 'c.ts'], 'a.ts');
    assert.deepEqual(getOpenViewerTabPaths(), ['b.ts', 'a.ts', 'c.ts']);
    assert.equal(getActiveViewerTabPath(), 'a.ts');
  });

  test('closeTabsUnderDeletedAncestor removes nested paths', async () => {
    await openViewerTab('pkg/a.ts', { skipUnsavedGuard: true });
    await openViewerTab('pkg/sub/b.ts', { skipUnsavedGuard: true });
    await openViewerTab('other.ts', { skipUnsavedGuard: true });
    closeViewerTabsUnderAncestor('pkg');
    assert.deepEqual(getOpenViewerTabPaths(), ['other.ts']);
  });

  test('activateTab returns false when confirmUnsaved rejects', async () => {
    await openViewerTab('a.ts', { skipUnsavedGuard: true, content: 'x' });
    const tab = await openViewerTab('b.ts', { skipUnsavedGuard: true, content: 'y' });
    assert.ok(tab);
    tab.tab.isDirty = true;
    const ok = await activateViewerTab('a.ts', {
      confirmUnsaved: () => false,
    });
    assert.equal(ok, false);
    assert.equal(getActiveViewerTabPath(), 'b.ts');
  });

  test('clearAllViewerTabs resets store', async () => {
    await openViewerTab('x.ts', { skipUnsavedGuard: true });
    clearAllViewerTabs();
    assert.equal(getActiveViewerTabPath(), null);
  });

  test('reorderViewerTab updates tab order', async () => {
    await openViewerTab('a.ts', { skipUnsavedGuard: true });
    await openViewerTab('b.ts', { skipUnsavedGuard: true });
    reorderViewerTab('a.ts', 1);
    assert.deepEqual(getOpenViewerTabPaths(), ['b.ts', 'a.ts']);
  });
});
