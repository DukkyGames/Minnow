import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Mirrors bulk checkbox logic in src/tools/config.ts without DOM.
 */
function getToolBulkCheckboxState(enabled, eligibleIds) {
  if (eligibleIds.length === 0) {
    return { checked: false, indeterminate: false };
  }

  const enabledCount = eligibleIds.filter((id) => enabled[id] === true).length;
  if (enabledCount === 0) {
    return { checked: false, indeterminate: false };
  }
  if (enabledCount === eligibleIds.length) {
    return { checked: true, indeterminate: false };
  }
  return { checked: false, indeterminate: true };
}

describe('tool bulk checkbox state', () => {
  test('unchecked when none enabled', () => {
    const state = getToolBulkCheckboxState(
      { a: false, b: false },
      ['a', 'b'],
    );
    assert.equal(state.checked, false);
    assert.equal(state.indeterminate, false);
  });

  test('checked when all eligible enabled', () => {
    const state = getToolBulkCheckboxState(
      { a: true, b: true },
      ['a', 'b'],
    );
    assert.equal(state.checked, true);
    assert.equal(state.indeterminate, false);
  });

  test('indeterminate when partially enabled', () => {
    const state = getToolBulkCheckboxState(
      { a: true, b: false },
      ['a', 'b'],
    );
    assert.equal(state.checked, false);
    assert.equal(state.indeterminate, true);
  });
});
