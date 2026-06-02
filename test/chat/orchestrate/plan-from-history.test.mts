/**
 * findLastPlanSavePath — synthetic save_file tool rows in chat history.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findLastPlanSavePath } from '../../../src/chat/orchestrate/plan-from-history.ts';
import type {
  AssistantToolCallMessage,
  Message,
  ToolResultMessage,
} from '../../../src/types.ts';

const PLAN_A = 'documentation/plans/wave-one.md';
const PLAN_B = 'documentation/plans/wave-two.md';
const CALL_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CALL_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function saveFileTurn(
  callId: string,
  planPath: string,
  resultText: string,
): Message[] {
  const assistant: AssistantToolCallMessage = {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name: 'save_file',
          arguments: JSON.stringify({ path: planPath, content: '# Plan' }),
        },
      },
    ],
  };
  const tool: ToolResultMessage = {
    role: 'tool',
    tool_call_id: callId,
    content: resultText,
  };
  return [assistant, tool];
}

describe('findLastPlanSavePath', () => {
  test('returns undefined for empty history', () => {
    assert.equal(findLastPlanSavePath([]), undefined);
  });

  test('returns latest save_file plan path when multiple saves exist', () => {
    const history: Message[] = [
      ...saveFileTurn(CALL_A, PLAN_A, `Saved ${PLAN_A} (120 bytes)`),
      { role: 'user', content: 'continue' },
      ...saveFileTurn(CALL_B, PLAN_B, `Saved ${PLAN_B} (80 bytes)`),
    ];
    assert.equal(findLastPlanSavePath(history), PLAN_B);
  });

  test('reads path from tool result when args omit path', () => {
    const assistant: AssistantToolCallMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: CALL_A,
          type: 'function',
          function: { name: 'save_file', arguments: '{}' },
        },
      ],
    };
    const tool: ToolResultMessage = {
      role: 'tool',
      tool_call_id: CALL_A,
      content: PLAN_A,
    };
    assert.equal(findLastPlanSavePath([assistant, tool]), PLAN_A);
  });

  test('ignores save_file outside documentation/plans', () => {
    const history = saveFileTurn(
      CALL_A,
      'documentation/plans/references/readme.md',
      'Saved documentation/plans/references/readme.md (10 bytes)',
    );
    assert.equal(findLastPlanSavePath(history), undefined);
  });

  test('ignores non-save_file tools', () => {
    const assistant: AssistantToolCallMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: CALL_A,
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: PLAN_A }),
          },
        },
      ],
    };
    const tool: ToolResultMessage = {
      role: 'tool',
      tool_call_id: CALL_A,
      content: PLAN_A,
    };
    assert.equal(findLastPlanSavePath([assistant, tool]), undefined);
  });

  test('normalizes backslashes in saved path', () => {
    const windowsPath = 'documentation\\plans\\windows-plan.md';
    const history = saveFileTurn(
      CALL_A,
      windowsPath,
      `Saved ${windowsPath} (50 bytes)`,
    );
    assert.equal(findLastPlanSavePath(history), 'documentation/plans/windows-plan.md');
  });
});
