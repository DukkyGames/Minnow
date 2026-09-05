/**
 * Peek panel DOM contract: description-first sticky, collapsed empty sections.
 *
 * Cards are injected via `setIssuesStateForTests` so addIssue cannot schedule a
 * persist that hangs the runner waiting on /api.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import type { IssueCard } from '../../src/types.ts';
import { ISSUES_COMPAT_VERSION, ISSUES_SCHEMA_VERSION } from '../../src/types.ts';

const { findIssueById, setIssuesStateForTests } = await import('../../src/state/issues-store.ts');
const { closeIssueDetail, openIssueDetail } = await import('../../src/ui/issues-detail.ts');
const { resetGhAvailableCache } = await import('../../src/chat/issues/git-actions.ts');
const { setLocalServerAvailableForTests, setToolConfigForTests } = await import(
  '../../src/tools/config.ts'
);
const { defaultToolConfig } = await import('../../src/config/defaults.ts');

const FIXED_NOW = 1_710_000_006_000;

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window({ url: 'http://localhost/' });
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.NodeFilter = window.NodeFilter;
  globalThis.Element = window.Element;
  globalThis.SVGElement = window.SVGElement;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  setLocalServerAvailableForTests(false);
  setToolConfigForTests(defaultToolConfig());

  document.body.innerHTML = `
    <main id="issuesView" class="issues-page">
      <div class="issues-shell">
        <div class="issues-body"></div>
      </div>
    </main>
  `;
}

function seedIssues(issues: IssueCard[]): void {
  setIssuesStateForTests({
    version: ISSUES_COMPAT_VERSION,
    schemaRevision: ISSUES_SCHEMA_VERSION,
    nextId: 5,
    issues,
    workspaces: {},
  });
}

function headingTexts(root: Element): string[] {
  return [...root.querySelectorAll('.issues-detail__section-title')].map(
    (el) => el.textContent ?? '',
  );
}

afterEach(() => {
  closeIssueDetail();
  resetGhAvailableCache();
  setIssuesStateForTests(null);
  domWindow?.close();
  domWindow = null;
});

describe('issues detail display', () => {
  test('empty peek is identity + description, not a stack of empty sections', () => {
    setupDom();
    seedIssues([
      {
        id: 'GET-3',
        type: 'task',
        title: 'test',
        description: '',
        status: 'backlog',
        priority: 'none',
        labels: ['TEST'],
        workspacePath: 'C:/Users/dukky/Projects/getsitdone',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        source: 'user',
      },
    ]);

    openIssueDetail('GET-3');

    const sticky = document.querySelector('.issues-detail__sticky');
    const scroll = document.querySelector('.issues-detail__scroll');
    assert.ok(sticky);
    assert.ok(scroll);

    assert.equal(sticky.querySelector('.issues-detail__id')?.textContent, 'GET-3');
    assert.equal(
      sticky.querySelector('.issues-detail__close')?.getAttribute('aria-label'),
      'Close issue detail',
    );
    assert.equal(
      sticky.querySelector('.issues-detail__more')?.getAttribute('aria-label'),
      'Issue actions',
    );
    assert.equal(sticky.querySelector('.issues-detail__delete'), null);
    assert.equal(sticky.querySelectorAll('select').length, 0);
    assert.ok(sticky.querySelector('.issues-detail__prop[aria-label="Type: Task"]'));
    assert.ok(sticky.querySelector('.issues-detail__prop[aria-haspopup="menu"]'));
    assert.ok(sticky.querySelector('.issues-workflow-menu-wrap'));

    const titles = headingTexts(scroll);
    assert.equal(titles.includes('Description'), false);
    assert.equal(titles.includes('Activity'), false);
    assert.equal(titles.includes('Plan'), false);
    assert.equal(titles.includes('Related issues'), false);
    assert.equal(titles.includes('Code links'), false);
    assert.equal(titles.includes('Git'), false);

    const copy = scroll.textContent ?? '';
    assert.equal(copy.includes('No code links yet.'), false);
    assert.equal(copy.includes('No plan yet.'), false);
    assert.equal(copy.includes('No related issues yet.'), false);
    assert.equal(copy.includes('No linked branches'), false);

    assert.ok(scroll.querySelector('input[aria-label="Paste code link"]'));
    assert.ok(
      [...scroll.querySelectorAll('button')].some((btn) => btn.textContent === 'Attach…'),
    );
    assert.ok(
      [...scroll.querySelectorAll('button')].some((btn) => btn.textContent === 'Create branch'),
    );
    assert.ok(
      [...scroll.querySelectorAll('button')].some((btn) => btn.textContent === 'Link…'),
    );
    assert.ok(scroll.querySelector('.issues-detail__section--document'));
    assert.ok(scroll.querySelector('.issues-detail__section--meta'));
  });

  test('filled peek shows headings only for sections that have content', () => {
    setupDom();
    seedIssues([
      {
        id: 'GET-4',
        type: 'task',
        title: 'Has body',
        description: 'A real description.',
        status: 'backlog',
        priority: 'none',
        labels: [],
        workspacePath: '/repo',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        source: 'user',
        planPath: 'documentation/plans/issues/GET-4.md',
        codeRefs: [{ path: 'src/ui/issues-detail.ts', startLine: 12 }],
        issueRefs: [{ issueId: 'GET-3', kind: 'related', addedAt: FIXED_NOW }],
      },
    ]);

    openIssueDetail('GET-4');

    const scroll = document.querySelector('.issues-detail__scroll');
    assert.ok(scroll);
    const titles = headingTexts(scroll);
    assert.ok(titles.includes('Code links'));
    assert.ok(titles.includes('Plan'));
    assert.ok(titles.includes('Related issues'));
    assert.equal(titles.includes('Description'), false);
  });

  test('typing a description in peek is written to the store on close', () => {
    setupDom();
    seedIssues([
      {
        id: 'GET-3',
        type: 'task',
        title: 'test',
        description: '',
        status: 'backlog',
        priority: 'none',
        labels: [],
        workspacePath: '/repo',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        source: 'user',
      },
    ]);

    openIssueDetail('GET-3');
    const para = document.querySelector('.mn-editor__para');
    assert.ok(para);
    para.textContent = 'Repro: save from peek.';
    closeIssueDetail();

    assert.equal(findIssueById('GET-3')?.description, 'Repro: save from peek.');
  });

  test('editing an existing description is written to the store on close', () => {
    setupDom();
    seedIssues([
      {
        id: 'GET-4',
        type: 'task',
        title: 'Has body',
        description: 'A real description.',
        status: 'backlog',
        priority: 'none',
        labels: [],
        workspacePath: '/repo',
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        source: 'user',
      },
    ]);

    openIssueDetail('GET-4');
    const para = document.querySelector('.mn-editor__para');
    assert.ok(para);
    para.textContent = 'Updated description.';
    closeIssueDetail();

    assert.equal(findIssueById('GET-4')?.description, 'Updated description.');
  });
});
