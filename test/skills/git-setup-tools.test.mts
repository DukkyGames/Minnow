/**
 * /git-setup must expose shell + git-write tools during orchestrate board preflight.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isToolAllowedForMode } from '../../src/chat/modes/tool-policy.ts';
import { GIT_SETUP_SKILL_ID } from '../../src/skills/git-setup-client.ts';
import { getEnabledToolDefinitionsForChat } from '../../src/tools/client.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';

describe('git-setup skill tool grant', () => {
  test('orchestrate mode denies execute_command without the skill grant', () => {
    assert.equal(isToolAllowedForMode('orchestrate', 'execute_command'), false);
    assert.equal(isToolAllowedForMode('orchestrate', 'git_add'), false);
  });

  test('orchestrate planner chat exposes git-setup tools when skillId is set', () => {
    const chat = createEmptyChatObject('orchestrate');
    const names = new Set(
      getEnabledToolDefinitionsForChat(chat, { skillId: GIT_SETUP_SKILL_ID }).map(
        (d) => d.function.name,
      ),
    );
    assert.ok(names.has('execute_command'), 'git init uses execute_command');
    assert.ok(names.has('git_add'));
    assert.ok(names.has('git_commit'));
    assert.ok(names.has('save_file'));
  });

  test('orchestrate planner chat omits shell tools without git-setup skill', () => {
    const chat = createEmptyChatObject('orchestrate');
    const names = getEnabledToolDefinitionsForChat(chat).map((d) => d.function.name);
    assert.ok(!names.includes('execute_command'));
    assert.ok(!names.includes('git_add'));
  });
});
