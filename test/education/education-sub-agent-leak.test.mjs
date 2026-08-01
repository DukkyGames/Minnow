/**
 * The highest-value regression: Education Mode must survive every path that
 * re-derives a tool list from a *different* policy than the composer's.
 *
 * - resolve-sub-agent-tool-mode silently upgrades plan-family sub-agents to
 *   Build policy, so a student could otherwise get code written by asking for
 *   a sub-agent.
 * - board build/fix roles carry their own files-write allowlist that bypasses
 *   the mode matrix entirely.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resolveSubAgentToolModeId } from '../../src/agents/resolve-sub-agent-tool-mode.ts';
import { resolveSubAgentTools } from '../../src/agents/sub-agent-tools.ts';
import { applyBoardMemberToolFilter } from '../../src/chat/modes/orchestrate-tool-filter.ts';
import {
  resetEducationMetaCache,
  setEducationMetaForTests,
} from '../../src/config/education-meta.ts';
import { expandBoardRoleAllowedTools } from '../../src/chat/modes/tool-groups.ts';

const WRITE_TOOLS = [
  'save_file',
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'make_directory',
  'delete_path',
  'run_python',
];

const def = (name) => ({
  type: 'function',
  function: { name, description: name, parameters: { type: 'object', properties: {} } },
});

const parentEnabled = [
  ...WRITE_TOOLS.map(def),
  def('read_file'),
  def('grep'),
  def('execute_command'),
  def('git_diff'),
  def('todo_write'),
];

function subAgentConfig(overrides = {}) {
  return {
    enabled: true,
    providerId: 'lm-studio-local',
    modelId: '',
    maxConcurrent: 1,
    timeoutMs: 300000,
    workAgentId: null,
    allowedTools: null,
    deniedTools: [],
    systemPromptPath: null,
    ...overrides,
  };
}

function names(defs) {
  return defs.map((d) => d.function.name);
}

describe('education mode sub-agent and board leaks', () => {
  afterEach(() => {
    resetEducationMetaCache();
  });

  describe('with education off', () => {
    beforeEach(() => {
      setEducationMetaForTests({ enabled: false, level: 'beginner' });
    });

    test('sub-agents still inherit write tools', () => {
      const tools = names(
        resolveSubAgentTools(subAgentConfig(), 'generalPurpose', parentEnabled),
      );
      assert.ok(tools.includes('save_file'));
    });
  });

  describe('with education on', () => {
    beforeEach(() => {
      setEducationMetaForTests({ enabled: true, level: 'beginner' });
    });

    test('plan-family sub-agents get no write tools despite the build upgrade', () => {
      // The upgrade itself is intentional and stays: reviewers need to read the repo.
      assert.equal(resolveSubAgentToolModeId('plan'), 'build');
      assert.equal(resolveSubAgentToolModeId('super-plan'), 'build');

      const tools = names(
        resolveSubAgentTools(subAgentConfig(), 'plan-reviewer', parentEnabled),
      );
      for (const write of WRITE_TOOLS) {
        assert.ok(!tools.includes(write), `sub-agent kept write tool ${write}`);
      }
      assert.ok(tools.includes('read_file'));
      assert.ok(tools.includes('execute_command'));
    });

    test('a type allowlist cannot re-add save_file', () => {
      const tools = names(
        resolveSubAgentTools(
          subAgentConfig({ allowedTools: ['save_file', 'read_file'] }),
          'generalPurpose',
          parentEnabled,
        ),
      );
      assert.deepEqual(tools, ['read_file']);
    });

    test('board build role loses its files-write allowlist', () => {
      // The role matrix itself still grants writes; the overlay is what removes them.
      assert.ok(expandBoardRoleAllowedTools('build').has('save_file'));

      const chat = { id: 'chat-1', boardTaskId: 'task-1' };
      const tools = names(applyBoardMemberToolFilter(parentEnabled, chat));
      for (const write of WRITE_TOOLS) {
        assert.ok(!tools.includes(write), `board builder kept write tool ${write}`);
      }
      assert.ok(tools.includes('execute_command'));
      assert.ok(tools.includes('todo_write'));
    });

    test('board filter is untouched for non-board chats', () => {
      const chat = { id: 'chat-1' };
      assert.deepEqual(applyBoardMemberToolFilter(parentEnabled, chat), parentEnabled);
    });
  });
});
