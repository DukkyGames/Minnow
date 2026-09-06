/**
 * Workspace issue-label catalog: first-unused swatches and list overflow.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ISSUE_LABEL_SWATCH_IDS,
  mergeIssueLabelCatalog,
  pickNextLabelSwatch,
  splitIssueLabelsForList,
  uniqueIssueLabelNames,
} from '../../src/issues/label-catalog.ts';

describe('issue label catalog', () => {
  test('pickNextLabelSwatch walks the palette then reuses the least-used', () => {
    assert.equal(pickNextLabelSwatch([]), 'clay');
    assert.equal(pickNextLabelSwatch(['clay']), 'apricot');
    const allOnce = [...ISSUE_LABEL_SWATCH_IDS];
    assert.equal(pickNextLabelSwatch(allOnce), 'clay');
    assert.equal(pickNextLabelSwatch([...allOnce, 'clay']), 'apricot');
  });

  test('mergeIssueLabelCatalog assigns missing names without recoloring existing ones', () => {
    const first = mergeIssueLabelCatalog([], ['UX', 'API']);
    assert.equal(first.changed, true);
    assert.deepEqual(first.catalog, [
      { name: 'API', color: 'clay' },
      { name: 'UX', color: 'apricot' },
    ]);

    const second = mergeIssueLabelCatalog(first.catalog, ['UX', 'API', 'MAP']);
    assert.equal(second.changed, true);
    assert.equal(second.catalog.find((entry) => entry.name === 'UX')?.color, 'apricot');
    assert.equal(second.catalog.find((entry) => entry.name === 'MAP')?.color, 'pollen');
  });

  test('uniqueIssueLabelNames keeps first-seen casing and sorts stably', () => {
    assert.deepEqual(uniqueIssueLabelNames([['UX', 'api'], ['API', 'Map']]), ['api', 'Map', 'UX']);
  });

  test('splitIssueLabelsForList caps visible chips at three', () => {
    assert.deepEqual(splitIssueLabelsForList(['a', 'b', 'c', 'd', 'e']), {
      visible: ['a', 'b', 'c'],
      hidden: ['d', 'e'],
      hiddenCount: 2,
    });
    assert.deepEqual(splitIssueLabelsForList(['a']), {
      visible: ['a'],
      hidden: [],
      hiddenCount: 0,
    });
  });
});
