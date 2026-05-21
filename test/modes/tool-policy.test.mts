/**
 * Mode tool policy filter tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { filterToolsByMode } from '../../src/chat/modes/tool-policy.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';

function findTool(id: string) {
  const tool = BUILT_IN_TOOLS.find((t) => t.id === id);
  assert.ok(tool, `missing tool ${id}`);
  return tool;
}

describe('filterToolsByMode', () => {
  test('plan excludes execute_command', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'plan');
    assert.ok(!filtered.some((t) => t.id === 'execute_command'));
  });

  test('plan includes save_file for plan document writes', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'plan');
    assert.ok(filtered.some((t) => t.id === 'save_file'));
  });

  test('build includes execute_command when in catalog list', () => {
    const filtered = filterToolsByMode([findTool('execute_command')], 'build');
    assert.equal(filtered.length, 1);
  });

  test('research excludes save_file', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'research');
    assert.ok(!filtered.some((t) => t.id === 'save_file'));
  });

  test('research includes web_search when in catalog list', () => {
    const filtered = filterToolsByMode([findTool('web_search')], 'research');
    assert.equal(filtered.length, 1);
  });
});
