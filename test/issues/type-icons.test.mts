import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDefaultIssuesTaxonomy,
  validateIssuesTaxonomy,
} from '../../src/issues/taxonomy.ts';
import {
  DEFAULT_ISSUE_TYPE_ICONS,
  isIssueTypeIconClass,
  resolveIssueTypeIcon,
} from '../../src/issues/type-icons.ts';

describe('issue type icons', () => {
  it('seeds built-in types with default icons', () => {
    const taxonomy = createDefaultIssuesTaxonomy();
    assert.equal(taxonomy.types.find((t) => t.id === 'bug')?.icon, DEFAULT_ISSUE_TYPE_ICONS.bug);
    assert.equal(taxonomy.types.find((t) => t.id === 'task')?.icon, DEFAULT_ISSUE_TYPE_ICONS.task);
    assert.equal(taxonomy.types.find((t) => t.id === 'idea')?.icon, DEFAULT_ISSUE_TYPE_ICONS.idea);
    assert.equal(taxonomy.types.find((t) => t.id === 'note')?.icon, DEFAULT_ISSUE_TYPE_ICONS.note);
  });

  it('resolves stored icons and falls back for unknown custom types', () => {
    assert.equal(resolveIssueTypeIcon('bug', { id: 'bug', label: 'Bug', order: 0 }), 'fi-sr-bug');
    assert.equal(
      resolveIssueTypeIcon('spike', {
        id: 'spike',
        label: 'Spike',
        order: 0,
        icon: 'fi-sr-rocket',
      }),
      'fi-sr-rocket',
    );
    assert.equal(
      resolveIssueTypeIcon('spike', { id: 'spike', label: 'Spike', order: 0 }),
      'fi-sr-box',
    );
  });

  it('rejects icons outside the picker catalog', () => {
    const base = createDefaultIssuesTaxonomy();
    const next = structuredClone(base);
    next.types.push({
      id: 'spike',
      label: 'Spike',
      order: 4,
      icon: 'fi-sr-not-a-real-icon',
    });
    assert.throws(() => validateIssuesTaxonomy(next), /Unknown type icon/);
  });

  it('accepts picker icons on custom types', () => {
    const base = createDefaultIssuesTaxonomy();
    const next = structuredClone(base);
    next.types.push({
      id: 'spike',
      label: 'Spike',
      order: 4,
      icon: 'fi-sr-rocket',
    });
    const validated = validateIssuesTaxonomy(next);
    assert.equal(validated.types.find((t) => t.id === 'spike')?.icon, 'fi-sr-rocket');
    assert.equal(isIssueTypeIconClass('fi-sr-rocket'), true);
    assert.equal(isIssueTypeIconClass('fi-sr-not-a-real-icon'), false);
  });
});
