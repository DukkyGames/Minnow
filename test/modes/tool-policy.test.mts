/**
 * Mode tool policy filter tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MODE_IDS, type ModeId } from '../../src/chat/modes/types.ts';
import { filterToolsByMode, isToolAllowedForMode } from '../../src/chat/modes/tool-policy.ts';
import {
  MODE_ALLOWED_GROUPS,
  TOOL_GROUP_IDS,
  TOOL_GROUP_ID_LIST,
  buildToolIdToGroupsMap,
  expandToolGroups,
} from '../../src/chat/modes/tool-groups.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';

function findTool(id: string) {
  const tool = BUILT_IN_TOOLS.find((t) => t.id === id);
  assert.ok(tool, `missing tool ${id}`);
  return tool;
}

function filteredIds(modeId: ModeId): Set<string> {
  return new Set(filterToolsByMode(BUILT_IN_TOOLS, modeId).map((t) => t.id));
}

function estimateToolPayloadTokens(defs: { definition: { function: { name: string; description: string; parameters: unknown } } }[]): number {
  const json = JSON.stringify(defs.map((t) => t.definition));
  return Math.round(json.length / 4);
}

/** Whether every tool in `groupId` is allowed for `modeId`. */
function groupFullyAllowed(modeId: ModeId, groupId: keyof typeof TOOL_GROUP_IDS): boolean {
  return TOOL_GROUP_IDS[groupId].every((id) => isToolAllowedForMode(modeId, id));
}

/** Whether every tool in `groupId` is denied for `modeId`. */
function groupFullyDenied(modeId: ModeId, groupId: keyof typeof TOOL_GROUP_IDS): boolean {
  return TOOL_GROUP_IDS[groupId].every((id) => !isToolAllowedForMode(modeId, id));
}

describe('external dynamic tools (MCP / plugins)', () => {
  test('mcp__ and plugin__ tools bypass per-mode deny-by-default matrix', () => {
    const mcpTool = 'mcp__context7__resolve-library-id';
    const pluginTool = 'plugin__my-plugin__run';
    for (const modeId of MODE_IDS) {
      assert.ok(
        isToolAllowedForMode(modeId, mcpTool),
        `${mcpTool} should be allowed in ${modeId}`,
      );
      assert.ok(
        isToolAllowedForMode(modeId, pluginTool),
        `${pluginTool} should be allowed in ${modeId}`,
      );
    }
  });
});

describe('filterToolsByMode', () => {
  test('plan includes execute_command per final matrix (MIN-332)', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'plan');
    assert.ok(filtered.some((t) => t.id === 'execute_command'));
  });

  test('plan includes save_file and make_directory for plan document writes', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'plan');
    assert.ok(filtered.some((t) => t.id === 'save_file'));
    assert.ok(filtered.some((t) => t.id === 'make_directory'));
  });

  test('plan excludes mutating file-write tools', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'plan');
    for (const id of [
      'append_file',
      'insert_at_line',
      'replace_text_in_file',
      'delete_path',
      'move_file',
      'copy_file',
    ]) {
      assert.ok(!filtered.some((t) => t.id === id), `plan should deny ${id}`);
    }
  });

  test('build includes execute_command when in catalog list', () => {
    const filtered = filterToolsByMode([findTool('execute_command')], 'build');
    assert.equal(filtered.length, 1);
  });

  test('general includes execute_command and save_file like build', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'general');
    assert.ok(filtered.some((t) => t.id === 'execute_command'));
    assert.ok(filtered.some((t) => t.id === 'save_file'));
    assert.ok(filtered.some((t) => t.id === 'spawn_sub_agent'));
  });

  test('desktop includes every built-in tool group', () => {
    const filtered = filterToolsByMode(BUILT_IN_TOOLS, 'desktop');
    for (const groupId of TOOL_GROUP_ID_LIST) {
      for (const toolId of TOOL_GROUP_IDS[groupId]) {
        assert.ok(
          filtered.some((t) => t.id === toolId),
          `desktop should allow ${toolId} (${groupId})`,
        );
      }
    }
  });
});

describe('per-mode matrix groups', () => {
  for (const modeId of MODE_IDS) {
    test(`${modeId} matches MODE_ALLOWED_GROUPS matrix`, () => {
      const allowedGroups = new Set(MODE_ALLOWED_GROUPS[modeId]);
      for (const groupId of TOOL_GROUP_ID_LIST) {
        const shouldAllow = allowedGroups.has(groupId);
        if (groupId === 'files-write' && modeId === 'plan') {
          // Plan: partial files-write — only save_file + make_directory
          assert.ok(isToolAllowedForMode(modeId, 'save_file'));
          assert.ok(isToolAllowedForMode(modeId, 'make_directory'));
          assert.ok(!isToolAllowedForMode(modeId, 'append_file'));
          continue;
        }
        if (groupId === 'sub-agents' && modeId === 'orchestrate') {
          assert.ok(!isToolAllowedForMode(modeId, 'spawn_sub_agent'));
          assert.ok(!isToolAllowedForMode(modeId, 'cancel_sub_agent'));
          assert.ok(isToolAllowedForMode(modeId, 'list_sub_agents'));
          assert.ok(isToolAllowedForMode(modeId, 'get_sub_agent_status'));
          continue;
        }
        if (shouldAllow) {
          assert.ok(
            groupFullyAllowed(modeId, groupId),
            `${modeId} should allow full group ${groupId}`,
          );
        } else {
          assert.ok(
            groupFullyDenied(modeId, groupId),
            `${modeId} should deny full group ${groupId}`,
          );
        }
      }
    });
  }
});

describe('cross-mode policy invariants', () => {
  const BUG_TOOLS = TOOL_GROUP_IDS['bug-board'];
  const BRAIN_TOOLS = TOOL_GROUP_IDS.brain;
  const EMAIL_TOOLS = TOOL_GROUP_IDS.email;
  const CALENDAR_TOOLS = TOOL_GROUP_IDS.calendar;

  test('bug-board tools allowed only in general, debug, and desktop', () => {
    for (const modeId of MODE_IDS) {
      for (const toolId of BUG_TOOLS) {
        const allowed = isToolAllowedForMode(modeId, toolId);
        const expected = modeId === 'general' || modeId === 'debug' || modeId === 'desktop';
        assert.equal(
          allowed,
          expected,
          `${toolId} in ${modeId}: expected ${expected}`,
        );
      }
    }
  });

  test('brain tools allowed in every mode', () => {
    for (const modeId of MODE_IDS) {
      for (const toolId of BRAIN_TOOLS) {
        assert.ok(
          isToolAllowedForMode(modeId, toolId),
          `${toolId} should be allowed in ${modeId}`,
        );
      }
    }
  });

  test('email and calendar denied except in desktop mode', () => {
    for (const modeId of MODE_IDS) {
      for (const toolId of [...EMAIL_TOOLS, ...CALENDAR_TOOLS]) {
        const allowed = isToolAllowedForMode(modeId, toolId);
        const expected = modeId === 'desktop';
        assert.ok(
          allowed === expected,
          `${toolId} in ${modeId}: expected ${expected}`,
        );
      }
    }
  });

  test('reef widget tool only in reef and desktop modes', () => {
    for (const modeId of MODE_IDS) {
      const allowed = isToolAllowedForMode(modeId, 'check_reef_widget');
      assert.equal(allowed, modeId === 'reef' || modeId === 'desktop', `check_reef_widget in ${modeId}`);
    }
  });

  test('board tools only in orchestrate and desktop modes', () => {
    for (const modeId of MODE_IDS) {
      for (const toolId of TOOL_GROUP_IDS.board) {
        const allowed = isToolAllowedForMode(modeId, toolId);
        assert.equal(
          allowed,
          modeId === 'orchestrate' || modeId === 'desktop',
          `${toolId} in ${modeId}`,
        );
      }
    }
  });
});

describe('tool payload token reduction', () => {
  test('build mode tool JSON payload is ~8,300 tokens (down from ~10,746)', () => {
    const allDefs = BUILT_IN_TOOLS.map((t) => t.definition);
    const allTokens = estimateToolPayloadTokens(
      allDefs.map((definition) => ({ definition })),
    );
    const buildDefs = filterToolsByMode(BUILT_IN_TOOLS, 'build').map((t) => t.definition);
    const buildTokens = estimateToolPayloadTokens(
      buildDefs.map((definition) => ({ definition })),
    );

    assert.ok(allTokens > 9_000, `baseline should exceed 9k, got ${allTokens}`);
    assert.ok(
      buildTokens >= 7_000 && buildTokens <= 8_200,
      `build payload expected ~7.5k–8.2k tok, got ${buildTokens} (all=${allTokens})`,
    );
    assert.ok(buildTokens < allTokens - 2_000, 'build should save at least 2k tokens');
  });

  test('every built-in tool belongs to at least one group', () => {
    const toolToGroups = buildToolIdToGroupsMap();
    for (const tool of BUILT_IN_TOOLS) {
      assert.ok(
        toolToGroups.has(tool.id),
        `built-in ${tool.id} missing from TOOL_GROUP_IDS`,
      );
    }
  });

  test('group expansion covers all allowed tools for each mode', () => {
    for (const modeId of MODE_IDS) {
      const fromGroups = new Set(expandToolGroups(MODE_ALLOWED_GROUPS[modeId]));
      const fromPolicy = filteredIds(modeId);
      for (const id of fromPolicy) {
        assert.ok(fromGroups.has(id) || modeId === 'plan', `${modeId}: ${id} not in groups`);
      }
    }
  });
});
