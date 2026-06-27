/**
 * File tree ↔ git panel worktree cwd sync.
 */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

register('../test-loader.mjs', import.meta.url);

import {
  panelPathsEqual,
  resolvePanelWorktreeCwd,
} from '../../src/ui/panel-worktree-cwd.ts';
import {
  buildFileTreeToolContext,
  fileTreeListingRootsEqual,
  resetFileTreeListingRootForTests,
  setFileTreeListingWorkspaceRoot,
} from '../../src/ui/file-tree-listing-root.ts';
import {
  resetFilePanelStateForTests,
  patchFilePanelState,
  getFilePanelState,
} from '../../src/state/file-panel.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';
import { setFileTreeServerAvailable } from '../../src/ui/file-tree-server.ts';
import { shouldScheduleFileTreeRefresh } from '../../src/ui/file-tree-auto-refresh.ts';

const MAIN_WS = 'C:/projects/minnow';
const WORKTREE = 'C:/projects/minnow/.minnow/worktrees/task-abc';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML =
    '<div id="fileSidebarTitle">Files</div><div id="fileTreeHost"></div>';
}

afterEach(() => {
  resetWorkspaceStateForTests();
  resetFileTreeListingRootForTests();
  resetFilePanelStateForTests();
  setFileTreeServerAvailable(false);
});

describe('resolvePanelWorktreeCwd', () => {
  test('returns undefined for main workspace path', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(resolvePanelWorktreeCwd(MAIN_WS), undefined);
    assert.equal(resolvePanelWorktreeCwd(`${MAIN_WS}\\`), undefined);
  });

  test('returns absolute path for isolated worktree', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(resolvePanelWorktreeCwd(WORKTREE), WORKTREE);
  });

  test('returns undefined when panel cwd is empty', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(resolvePanelWorktreeCwd(undefined), undefined);
    assert.equal(resolvePanelWorktreeCwd(''), undefined);
  });
});

describe('panelPathsEqual', () => {
  test('normalizes slashes and trailing separators', () => {
    assert.equal(panelPathsEqual('a/b/', 'a\\b'), true);
  });
});

describe('fileTreeListingRootsEqual', () => {
  test('treats undefined and main workspace as equivalent', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(fileTreeListingRootsEqual(undefined, MAIN_WS), true);
    assert.equal(fileTreeListingRootsEqual(MAIN_WS, undefined), true);
  });

  test('detects different worktree roots', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(fileTreeListingRootsEqual(undefined, WORKTREE), false);
    assert.equal(fileTreeListingRootsEqual(WORKTREE, WORKTREE), true);
  });
});

describe('buildFileTreeToolContext', () => {
  test('includes workspaceRoot when listing a worktree', () => {
    setFileTreeListingWorkspaceRoot(WORKTREE);
    assert.deepEqual(buildFileTreeToolContext(), { workspaceRoot: WORKTREE });
  });

  test('omits workspaceRoot for main workspace listing', () => {
    setFileTreeListingWorkspaceRoot(undefined);
    assert.deepEqual(buildFileTreeToolContext(), {});
  });
});

describe('syncFileTreeToPanelWorktree', () => {
  test('resets panel state and listing root when cwd changes', async () => {
    setupDom();
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    setFileTreeServerAvailable(false);
    patchFilePanelState({
      expandedDirs: ['src'],
      selectedPath: 'src/ui/file-tree.ts',
      openViewerTabs: ['src/ui/file-tree.ts'],
      activeViewerTab: 'src/ui/file-tree.ts',
    });

    const { syncFileTreeToPanelWorktree } = await import('../../src/ui/file-tree.ts');
    await syncFileTreeToPanelWorktree(WORKTREE);

    const state = getFilePanelState();
    assert.deepEqual(state.expandedDirs, []);
    assert.equal(state.selectedPath, null);
    assert.deepEqual(state.openViewerTabs, []);
    assert.equal(state.activeViewerTab, null);
    assert.equal(buildFileTreeToolContext().workspaceRoot, WORKTREE);
    assert.match(
      document.getElementById('fileSidebarTitle')?.textContent ?? '',
      /Files · task-abc/,
    );
  });

  test('no-op panel reset when root unchanged', async () => {
    setupDom();
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    setFileTreeListingWorkspaceRoot(undefined);
    patchFilePanelState({ expandedDirs: ['docs'], selectedPath: 'docs/readme.md' });

    const { syncFileTreeToPanelWorktree } = await import('../../src/ui/file-tree.ts');
    await syncFileTreeToPanelWorktree(MAIN_WS);

    assert.deepEqual(getFilePanelState().expandedDirs, ['docs']);
    assert.equal(buildFileTreeToolContext().workspaceRoot, undefined);
  });
});

describe('file tree tool context merge', () => {
  test('buildFileTreeToolContext supplies workspaceRoot for listing worktree', () => {
    setFileTreeListingWorkspaceRoot(WORKTREE);
    const merged = { ...buildFileTreeToolContext(), chatId: 'chat-1' };
    assert.deepEqual(merged, { workspaceRoot: WORKTREE, chatId: 'chat-1' });
  });
});

describe('shouldScheduleFileTreeRefresh with worktree listing', () => {
  test('allows refresh when tool and tree share worktree root', () => {
    setFileTreeServerAvailable(true);
    setFileTreeListingWorkspaceRoot(WORKTREE);
    assert.equal(
      shouldScheduleFileTreeRefresh('save_file', { content: 'Wrote file.' }, WORKTREE),
      true,
    );
  });

  test('skips refresh when tree is main but tool wrote to worktree', () => {
    setFileTreeServerAvailable(true);
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    setFileTreeListingWorkspaceRoot(undefined);
    assert.equal(
      shouldScheduleFileTreeRefresh('save_file', { content: 'Wrote file.' }, WORKTREE),
      false,
    );
  });

  test('skips refresh when tree is worktree but tool wrote to main', () => {
    setFileTreeServerAvailable(true);
    setFileTreeListingWorkspaceRoot(WORKTREE);
    assert.equal(
      shouldScheduleFileTreeRefresh('save_file', { content: 'Wrote file.' }, undefined),
      false,
    );
  });
});
