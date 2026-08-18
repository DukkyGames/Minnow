import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  codeRefsExcludingPlan,
  inferIssuePlanPath,
  isIssuePlanCodeRef,
  normalizeIssuePlanPath,
} from '../../src/issues/plan-attach.ts';

describe('normalizeIssuePlanPath', () => {
  it('accepts executable plans under documentation/plans/', () => {
    assert.equal(
      normalizeIssuePlanPath('documentation/plans/gets-it-done.md'),
      'documentation/plans/gets-it-done.md',
    );
    assert.equal(
      normalizeIssuePlanPath('documentation/plans/issues/MIN-42.md'),
      'documentation/plans/issues/MIN-42.md',
    );
  });

  it('rejects non-plan paths and reference artifacts', () => {
    assert.equal(normalizeIssuePlanPath('src/foo.ts'), undefined);
    assert.equal(
      normalizeIssuePlanPath('documentation/plans/references/oauth-spec.md'),
      undefined,
    );
  });
});

describe('inferIssuePlanPath', () => {
  it('prefers explicit planPath', () => {
    assert.equal(
      inferIssuePlanPath({
        planPath: 'documentation/plans/custom.md',
        codeRefs: [{ path: 'documentation/plans/other.md' }],
      }),
      'documentation/plans/custom.md',
    );
  });

  it('falls back to a linked plan markdown file', () => {
    assert.equal(
      inferIssuePlanPath({
        codeRefs: [{ path: 'documentation/plans/gets-it-done.md', startLine: 1 }],
      }),
      'documentation/plans/gets-it-done.md',
    );
  });
});

describe('codeRefsExcludingPlan', () => {
  it('hides the plan file from the code list', () => {
    const refs = [
      { path: 'src/a.ts' },
      { path: 'documentation/plans/gets-it-done.md', startLine: 1 },
    ];
    const filtered = codeRefsExcludingPlan(refs, 'documentation/plans/gets-it-done.md');
    assert.deepEqual(filtered, [{ path: 'src/a.ts' }]);
  });

  it('treats any plan markdown as a plan ref when no planPath is set', () => {
    assert.equal(
      isIssuePlanCodeRef({ path: 'documentation/plans/issues/MIN-1.md' }),
      true,
    );
  });
});

describe('appendIssueLinks plan routing', () => {
  it('sets planPath instead of codeRefs for plan markdown', async () => {
    const { addIssue, appendIssueLinks, findIssueById } = await import(
      '../../src/state/issues-store.ts'
    );
    const issue = addIssue({ title: 'Plan me' });
    appendIssueLinks(issue.id, {
      codeRefs: [
        { path: 'src/foo.ts' },
        { path: 'documentation/plans/gets-it-done.md', startLine: 1 },
      ],
    });
    const updated = findIssueById(issue.id);
    assert.equal(updated?.planPath, 'documentation/plans/gets-it-done.md');
    assert.deepEqual(updated?.codeRefs?.map((ref) => ref.path), ['src/foo.ts']);
  });
});
