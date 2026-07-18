import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildGoalTranscriptExcerpt } from '../../src/chat/goal/prompt.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';

describe('buildGoalTranscriptExcerpt', () => {
  test('includes assistant tool_calls with function names', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = FIXED_CHAT_ID;
    chat.history = [
      { role: 'user', content: 'Fix the bug' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'export const x = 1;' },
      { role: 'assistant', content: 'Fixed the bug in src/a.ts.' },
    ];

    const excerpt = buildGoalTranscriptExcerpt(chat);
    assert.match(excerpt, /Assistant \[tool_calls\]: read_file/);
    assert.match(excerpt, /Tool \(call-1\): export const x = 1/);
    assert.match(excerpt, /Assistant: Fixed the bug/);
  });

  test('skips goalAchieved and evaluator continuation rows', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = FIXED_CHAT_ID;
    chat.history = [
      { role: 'user', content: 'Real user message' },
      {
        role: 'user',
        content: 'Continue working toward the active goal.\n\nGoal: tests pass',
      },
      { role: 'user', content: 'Goal achieved: done', goalAchieved: true },
    ];

    const excerpt = buildGoalTranscriptExcerpt(chat);
    assert.match(excerpt, /Real user message/);
    assert.doesNotMatch(excerpt, /Continue working toward/);
    assert.doesNotMatch(excerpt, /Goal achieved/);
  });

  test('truncates long tool output previews at 2000 chars', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = FIXED_CHAT_ID;
    const longOutput = 'x'.repeat(3000);
    chat.history = [{ role: 'tool', tool_call_id: 'call-2', content: longOutput }];

    const excerpt = buildGoalTranscriptExcerpt(chat);
    const toolLine = excerpt.split('\n\n').find((line) => line.startsWith('Tool (call-2):'));
    assert.ok(toolLine);
    assert.ok(toolLine.length < longOutput.length);
    assert.match(toolLine, /…$/);
  });

  test('keeps tail of transcript when total exceeds 48k chars', () => {
    const chat = createEmptyChatObject('m1');
    chat.id = FIXED_CHAT_ID;
    chat.history = [
      { role: 'user', content: 'HEAD-MARKER-' + 'a'.repeat(50_000) },
      { role: 'user', content: 'TAIL-MARKER-visible' },
    ];

    const excerpt = buildGoalTranscriptExcerpt(chat);
    assert.doesNotMatch(excerpt, /HEAD-MARKER/);
    assert.match(excerpt, /TAIL-MARKER-visible/);
    assert.ok(excerpt.length <= 48_000);
  });
});
