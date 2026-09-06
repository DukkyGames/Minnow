/**
 * Docked peek width clamp/persist and expand-to-sheet chrome.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import type { IssueCard } from '../../src/types.ts';
import { ISSUES_COMPAT_VERSION, ISSUES_SCHEMA_VERSION } from '../../src/types.ts';

const { setIssuesStateForTests } = await import('../../src/state/issues-store.ts');
const { closeIssueDetail, openIssueDetail, refreshIssueDetailIfOpen } = await import(
  '../../src/ui/issues-detail.ts'
);
const {
  ISSUES_PEEK_DEFAULT_W,
  ISSUES_PEEK_MIN_W,
  ISSUES_PEEK_WIDTH_STORAGE_KEY,
  clampIssuesPeekWidth,
  isIssueDetailSheetExpanded,
  persistIssuesPeekWidth,
  readIssuesPeekWidth,
  resetIssuesDetailLayoutForTests,
  setIssueDetailSheetExpanded,
} = await import('../../src/ui/issues-detail-layout.ts');
const { resetGhAvailableCache } = await import('../../src/chat/issues/git-actions.ts');
const { resetIssuesGithubForTests, setIssuesGithubMode } = await import(
  '../../src/state/issues-github.ts'
);
const { setLocalServerAvailableForTests, setToolConfigForTests } = await import(
  '../../src/tools/config.ts'
);
const { defaultToolConfig } = await import('../../src/config/defaults.ts');
const { resetWorkspaceStateForTests, setWorkspaceFromServer } = await import(
  '../../src/state/workspace.ts'
);

const FIXED_NOW = 1_710_000_006_000;
const WS_A = 'C:/Users/dukky/Projects/peek-a';
const WS_B = 'C:/Users/dukky/Projects/peek-b';

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window({ url: 'http://localhost/' });
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.localStorage = window.localStorage;
  setLocalServerAvailableForTests(false);
  setToolConfigForTests(defaultToolConfig());
  resetIssuesGithubForTests();
  setIssuesGithubMode('off');
  document.body.innerHTML = `
    <main id="issuesView" class="issues-page">
      <div class="issues-shell">
        <div class="issues-body"></div>
      </div>
    </main>
  `;
}

function seedIssue(): void {
  const issue: IssueCard = {
    id: 'VIN-10',
    type: 'task',
    title: 'test',
    description: 'Goal: native app',
    status: 'backlog',
    priority: 'high',
    labels: [],
    workspacePath: WS_A,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    source: 'user',
  };
  setIssuesStateForTests({
    version: ISSUES_COMPAT_VERSION,
    schemaRevision: ISSUES_SCHEMA_VERSION,
    nextId: 11,
    issues: [issue],
    workspaces: {},
  });
}

afterEach(() => {
  if (domWindow) closeIssueDetail();
  resetIssuesDetailLayoutForTests();
  resetGhAvailableCache();
  resetIssuesGithubForTests();
  setIssuesStateForTests(null);
  resetWorkspaceStateForTests();
  try {
    localStorage.removeItem(ISSUES_PEEK_WIDTH_STORAGE_KEY);
  } catch {
    /* missing in some DOM stubs */
  }
  domWindow?.close();
  domWindow = null;
});

describe('issues peek layout', () => {
  test('clamp keeps 380–70% of the Issues body', () => {
    assert.equal(clampIssuesPeekWidth(200, 1000), ISSUES_PEEK_MIN_W);
    assert.equal(clampIssuesPeekWidth(800, 1000), 700);
    assert.equal(clampIssuesPeekWidth(Number.NaN, 1000), ISSUES_PEEK_DEFAULT_W);
  });

  test('peek width persists per workspace', () => {
    setupDom();
    setWorkspaceFromServer({ path: WS_A, label: 'A', isDefault: false });
    persistIssuesPeekWidth(640);
    assert.equal(readIssuesPeekWidth(), 640);
    setWorkspaceFromServer({ path: WS_B, label: 'B', isDefault: false });
    assert.equal(readIssuesPeekWidth(), ISSUES_PEEK_DEFAULT_W);
    persistIssuesPeekWidth(480);
    setWorkspaceFromServer({ path: WS_A, label: 'A', isDefault: false });
    assert.equal(readIssuesPeekWidth(), 640);
  });

  test('open peek mounts a left-edge resizer and a larger-view control', () => {
    setupDom();
    seedIssue();
    openIssueDetail('VIN-10');

    const resizer = document.getElementById('issuesDetailResizer');
    assert.ok(resizer);
    assert.equal(resizer.getAttribute('role'), 'separator');
    assert.equal(
      document.querySelector('.issues-detail__layout-expand')?.getAttribute('aria-label'),
      'Open issue in a larger sheet',
    );

    refreshIssueDetailIfOpen();
    assert.equal(document.getElementById('issuesDetailResizer'), resizer);
  });

  test('expand control overlays the Issues body without closing the issue', () => {
    setupDom();
    seedIssue();
    openIssueDetail('VIN-10');
    setIssueDetailSheetExpanded(true);
    assert.equal(isIssueDetailSheetExpanded(), true);
    assert.ok(document.querySelector('.issues-shell')?.classList.contains('is-detail-expanded'));
    assert.equal(
      document.querySelector('.issues-detail__layout-expand')?.getAttribute('aria-label'),
      'Restore issue peek',
    );
    assert.equal(document.getElementById('issuesDetailHost')?.classList.contains('is-open'), true);
  });
});
