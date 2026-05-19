/**
 * UI Designer tool allowlist and plan-mode guard (Step 15).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import {
  assertUiDesignerToolAllowed,
  filterToolsForUiDesigner,
} from '../../src/agents/ui-designer/tools.ts';
import { UI_DESIGNER_TOOL_ALLOWLIST } from '../../src/agents/ui-designer/constants.ts';

describe('filterToolsForUiDesigner', () => {
  test('U4: only allowlist ids present', () => {
    const all = BUILT_IN_TOOLS.map((t) => t.definition);
    const filtered = filterToolsForUiDesigner(all);
    const names = filtered.map((t) => t.function.name).sort();
    const expected = [...UI_DESIGNER_TOOL_ALLOWLIST].sort();
    assert.deepEqual(names, expected);
    assert.ok(!names.includes('git_status'));
    assert.ok(!names.includes('execute_command'));
  });
});

describe('assertUiDesignerToolAllowed', () => {
  test('U5: plan mode blocks save_file', () => {
    const msg = assertUiDesignerToolAllowed('save_file', 'plan');
    assert.equal(msg, 'Error: UI Designer plan mode does not allow file writes');
  });

  test('implement mode allows save_file', () => {
    assert.equal(assertUiDesignerToolAllowed('save_file', 'implement'), null);
  });
});
