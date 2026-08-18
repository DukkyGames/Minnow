/**
 * Quick-capture draft persistence.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  isDraftEmpty,
  loadIssueCaptureDraft,
  resetIssueCaptureDraftForTests,
  saveIssueCaptureDraft,
  type IssueCaptureDraft,
} from '../../src/ui/issue-capture-draft.ts';

const WORKSPACE = '/tmp/minnow-test';

function sampleDraft(): IssueCaptureDraft {
  return {
    title: 'Fix the sidebar',
    targetIssueId: null,
    payload: {
      workspacePath: WORKSPACE,
      sourceLabel: 'Quick capture',
      items: [
        { kind: 'file', label: 'a.ts', codeRef: { path: 'src/a.ts' } },
        { kind: 'file', label: 'b.ts', codeRef: { path: 'src/b.ts' } },
      ],
    },
  };
}

describe('issue capture draft', () => {
  afterEach(() => {
    resetIssueCaptureDraftForTests();
  });

  it('round-trips title and multiple file chips per workspace', () => {
    saveIssueCaptureDraft(WORKSPACE, sampleDraft());
    const loaded = loadIssueCaptureDraft(WORKSPACE);
    assert.ok(loaded);
    assert.equal(loaded.title, 'Fix the sidebar');
    assert.equal(loaded.payload.items.length, 2);
    assert.equal(loaded.payload.items[1].codeRef?.path, 'src/b.ts');
  });

  it('clears when saved with an empty draft', () => {
    saveIssueCaptureDraft(WORKSPACE, sampleDraft());
    saveIssueCaptureDraft(WORKSPACE, null);
    assert.equal(loadIssueCaptureDraft(WORKSPACE), null);
  });

  it('treats whitespace-only title with no chips as empty', () => {
    const draft: IssueCaptureDraft = {
      title: '   ',
      targetIssueId: null,
      payload: { items: [] },
    };
    assert.equal(isDraftEmpty(draft), true);
    saveIssueCaptureDraft(WORKSPACE, draft);
    assert.equal(loadIssueCaptureDraft(WORKSPACE), null);
  });

  it('keeps a destination issue id even without a title', () => {
    const draft: IssueCaptureDraft = {
      title: '',
      targetIssueId: 'MIN-42',
      payload: { items: [] },
    };
    saveIssueCaptureDraft(WORKSPACE, draft);
    assert.equal(loadIssueCaptureDraft(WORKSPACE)?.targetIssueId, 'MIN-42');
  });
});
