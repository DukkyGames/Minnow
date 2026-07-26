import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  DEFAULT_FILE_PANEL_STATE,
  MAX_RECENT_VIEWER_FILES,
  getFilePanelState,
  normalizeFilePanelBlockForTests,
  resetFilePanelStateForTests,
} from '../../src/state/file-panel.ts';
import {
  RECENT_VIEWER_DEFAULT_WORKSPACE_KEY,
  clearRecentViewerFiles,
  listRecentViewerFiles,
  pruneRecentViewerFilesUnderAncestor,
  recordRecentViewerFile,
  remapRecentViewerFilesUnderAncestor,
  removeRecentViewerFile,
  resolveRecentViewerWorkspaceKey,
} from '../../src/state/recent-viewer-files.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';

describe('recent viewer files MRU', () => {
  beforeEach(() => {
    resetFilePanelStateForTests();
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: '/workspace/demo',
      label: 'demo',
      isDefault: false,
    });
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch;
  });

  test('resolveRecentViewerWorkspaceKey prefers override then workspace path', () => {
    assert.equal(
      resolveRecentViewerWorkspaceKey('C:\\Projects\\App'),
      'C:/Projects/App',
    );
    assert.equal(resolveRecentViewerWorkspaceKey(), '/workspace/demo');
    resetWorkspaceStateForTests();
    assert.equal(resolveRecentViewerWorkspaceKey(), RECENT_VIEWER_DEFAULT_WORKSPACE_KEY);
  });

  test('recordRecentViewerFile promotes path and caps list length', () => {
    const root = '/workspace/demo';
    for (let i = 0; i < MAX_RECENT_VIEWER_FILES + 3; i += 1) {
      recordRecentViewerFile(`src/f${i}.ts`, {
        workspaceRoot: root,
        openedAt: 1_000 + i,
      });
    }
    const list = listRecentViewerFiles(root);
    assert.equal(list.length, MAX_RECENT_VIEWER_FILES);
    assert.equal(list[0]?.path, `src/f${MAX_RECENT_VIEWER_FILES + 2}.ts`);
    recordRecentViewerFile('src/f0.ts', { workspaceRoot: root, openedAt: 9_000 });
    const again = listRecentViewerFiles(root);
    assert.equal(again[0]?.path, 'src/f0.ts');
    assert.equal(again.filter((e) => e.path === 'src/f0.ts').length, 1);
  });

  test('skips attachment virtual paths', () => {
    recordRecentViewerFile('.minnow/attachments/note.txt', {
      workspaceRoot: '/workspace/demo',
    });
    assert.deepEqual(listRecentViewerFiles('/workspace/demo'), []);
  });

  test('remove and clear update persisted map', () => {
    const root = '/workspace/demo';
    recordRecentViewerFile('a.ts', { workspaceRoot: root, openedAt: 1 });
    recordRecentViewerFile('b.ts', { workspaceRoot: root, openedAt: 2 });
    removeRecentViewerFile('a.ts', root);
    assert.deepEqual(
      listRecentViewerFiles(root).map((e) => e.path),
      ['b.ts'],
    );
    clearRecentViewerFiles(root);
    assert.deepEqual(listRecentViewerFiles(root), []);
    assert.equal(
      getFilePanelState().recentViewerFilesByWorkspace[root],
      undefined,
    );
  });

  test('prune and remap under ancestor', () => {
    const root = '/workspace/demo';
    recordRecentViewerFile('pkg/a.ts', { workspaceRoot: root, openedAt: 1 });
    recordRecentViewerFile('pkg/sub/b.ts', { workspaceRoot: root, openedAt: 2 });
    recordRecentViewerFile('other.ts', { workspaceRoot: root, openedAt: 3 });
    pruneRecentViewerFilesUnderAncestor('pkg', root);
    assert.deepEqual(
      listRecentViewerFiles(root).map((e) => e.path),
      ['other.ts'],
    );
    recordRecentViewerFile('lib/x.ts', { workspaceRoot: root, openedAt: 4 });
    remapRecentViewerFilesUnderAncestor('lib', 'src/lib', root);
    assert.deepEqual(
      listRecentViewerFiles(root).map((e) => e.path).sort(),
      ['other.ts', 'src/lib/x.ts'],
    );
  });

  test('normalizeFilePanelBlock loads recentViewerFilesByWorkspace', () => {
    const state = normalizeFilePanelBlockForTests({
      ...DEFAULT_FILE_PANEL_STATE,
      recentViewerFilesByWorkspace: {
        '/ws': [
          { path: 'readme.md', openedAt: 42 },
          { path: '.minnow/attachments/x', openedAt: 1 },
          { path: 'readme.md', openedAt: 99 },
        ],
      },
    });
    assert.deepEqual(state.recentViewerFilesByWorkspace, {
      '/ws': [{ path: 'readme.md', openedAt: 42 }],
    });
  });
});
