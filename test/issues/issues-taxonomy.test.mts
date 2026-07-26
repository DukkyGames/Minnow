import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countIssuesUsingTaxonomyId,
  createDefaultIssuesTaxonomy,
  defaultIssueStatusId,
  isClosedStatus,
  openIssueStatusIds,
  requireStatusIdForRole,
  slugifyTaxonomyLabel,
  statusIdForRole,
  validateIssuesTaxonomy,
} from '../src/issues/taxonomy.ts';

describe('issues taxonomy', () => {
  it('seeds defaults with unique roles and board columns', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    assert.equal(taxonomy.version, 1);
    assert.ok(taxonomy.types.length >= 4);
    assert.ok(taxonomy.statuses.length >= 8);
    assert.equal(statusIdForRole(taxonomy, 'triage'), 'triage');
    assert.equal(statusIdForRole(taxonomy, 'review'), 'review');
    assert.ok(boardVisibleCount(taxonomy) >= 6);
  });

  it('rejects duplicate status roles', () => {
    const base = createDefaultIssuesTaxonomy();
    const dup = structuredClone(base);
    dup.statuses.push({
      id: 'extra_triage',
      label: 'Extra triage',
      order: 99,
      role: 'triage',
      boardVisible: false,
    });
    assert.throws(() => validateIssuesTaxonomy(dup), /already assigned/);
  });

  it('blocks deleting ids still used by issues', () => {
    const previous = createDefaultIssuesTaxonomy();
    const next = structuredClone(previous);
    next.types = next.types.filter((t) => t.id !== 'bug');
    assert.throws(
      () =>
        validateIssuesTaxonomy(next, {
          previous,
          issues: [{ type: 'bug', status: 'triage', priority: 'none' }],
        }),
      /Used by 1 issue/,
    );
  });

  it('derives open statuses from isClosed flags', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    const open = openIssueStatusIds(taxonomy);
    assert.ok(open.includes('triage'));
    assert.ok(!open.includes('done'));
    assert.equal(isClosedStatus(taxonomy, 'done'), true);
    assert.equal(isClosedStatus(taxonomy, 'triage'), false);
  });

  it('resolves workflow role ids and slugifies labels', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    assert.equal(requireStatusIdForRole(taxonomy, 'planned'), 'planned');
    assert.equal(slugifyTaxonomyLabel('My Custom Status'), 'my_custom_status');
    assert.equal(defaultIssueStatusId(taxonomy), 'triage');
  });

  it('counts issue usage per taxonomy kind', () => {
    const issues = [
      { type: 'bug', status: 'triage', priority: 'high' },
      { type: 'bug', status: 'done', priority: 'none' },
    ];
    assert.equal(countIssuesUsingTaxonomyId('type', 'bug', issues), 2);
    assert.equal(countIssuesUsingTaxonomyId('status', 'done', issues), 1);
    assert.equal(countIssuesUsingTaxonomyId('priority', 'high', issues), 1);
  });
});

function boardVisibleCount(taxonomy: ReturnType<typeof createDefaultIssuesTaxonomy>): number {
  return taxonomy.statuses.filter((s) => s.boardVisible !== false).length;
}
