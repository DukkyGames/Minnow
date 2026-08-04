/**
 * Tests for client-side tool permission / workspace prompt heuristics.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  blockAfkInteractionAttempt,
  companionToolRequiresApproval,
  outsideWorkspaceBlockMessage,
  toolInvocationWouldPrompt,
} from '../../src/tools/permission-gate.ts';
import { defaultToolConfig, setToolConfigForTests } from '../../src/tools/config.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { ChatGroup } from '../../src/types.ts';

afterEach(() => {
  flushScheduledSessionSaveForTests();
  setSessionStateForTests(null);
  setToolConfigForTests(defaultToolConfig());
});

describe('companionToolRequiresApproval', () => {
  test('forces approval for mutating and command tools', () => {
    assert.equal(companionToolRequiresApproval('save_file'), true);
    assert.equal(companionToolRequiresApproval('git_commit'), true);
    assert.equal(companionToolRequiresApproval('execute_command'), true);
    assert.equal(companionToolRequiresApproval('email_action'), true);
  });

  test('does not force an extra prompt for read-only tools', () => {
    assert.equal(companionToolRequiresApproval('read_file'), false);
    assert.equal(companionToolRequiresApproval('web_search'), false);
    assert.equal(companionToolRequiresApproval('git_status'), false);
  });
});

describe('toolInvocationWouldPrompt', () => {
  test('ask mode prompts even when paths are inside workspace', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'src/foo.ts' },
        'ask',
        'workspace',
        'C:/proj',
      ),
      true,
    );
  });

  test('full permission skips modal when paths stay inside workspace', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'src/foo.ts' },
        'full',
        'workspace',
        'C:/proj',
      ),
      false,
    );
  });

  test('full permission blocks without modal when path escapes workspace in workspace FS mode', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'C:/Windows/system.ini' },
        'full',
        'workspace',
        'C:/proj',
      ),
      false,
    );
  });

  test('full filesystem mode skips path-only prompt', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'C:/Windows/system.ini' },
        'full',
        'full',
        'C:/proj',
      ),
      false,
    );
  });

  test('outsideWorkspaceBlockMessage matches server copy', () => {
    assert.equal(
      outsideWorkspaceBlockMessage('/'),
      'Error: Path "/" resolves outside the workspace directory. Enable full disk access in Settings → General → Filesystem access (dangerous) to allow paths outside the workspace.',
    );
  });
});

describe('AFK interaction execution guard', () => {
  test('denies an attempted question without opening UI and logs exactly that attempt', () => {
    const planner = createEmptyChatObject('model', '/tmp/ws');
    planner.id = 'planner-afk';
    planner.modeId = 'orchestrate';
    const group: ChatGroup = {
      id: 'group-afk',
      name: 'AFK board',
      workspacePath: '/tmp/ws',
      collapsed: false,
      order: 0,
      plannerChatId: planner.id,
    };
    setSessionStateForTests({
      version: 5,
      activeId: planner.id,
      chats: [planner],
      groups: [group],
    });
    initBoard(group, planner, {
      planPath: 'documentation/plans/afk.md',
      tasks: [{ id: 'W1-A', title: 'Task', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    group.orchestrateBoard!.executionMode = 'afk';
    const config = defaultToolConfig();
    config.enabled.ask_question = true;
    config.permissions.default.ask_question = 'full';
    setToolConfigForTests(config);

    const result = blockAfkInteractionAttempt(
      { chatId: planner.id, modeId: 'orchestrate' },
      'question',
      'ask_question was attempted during AFK execution',
    );

    assert.match(result?.content ?? '', /AFK execution denied user interaction/);
    const interactions = group.orchestrateBoard!.log?.filter(
      (event) => event.type === 'interaction_required',
    );
    assert.equal(interactions?.length, 1);
    assert.equal(interactions?.[0]?.detail?.interactionKind, 'question');
  });
});
