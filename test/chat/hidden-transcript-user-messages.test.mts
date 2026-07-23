/**
 * Hidden transcript user rows (sub-agent resume, Super Plan pipeline, etc.).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  hiddenTranscriptUserMessage,
  isHiddenTranscriptUserMessage,
  isSubAgentResumeUserMessage,
} from '../../src/chat/hidden-transcript-user-messages.ts';
import { buildSubAgentParentResumeMessage } from '../../src/chat/orchestrate/sub-agent-resume-message.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';

describe('hidden transcript user messages', () => {
  test('isSubAgentResumeUserMessage matches completion and check-in prefixes', () => {
    const completion = buildSubAgentParentResumeMessage('completion', [
      {
        runId: '11111111-1111-1111-1111-111111111111',
        type: 'generalPurpose',
        task: 'scan',
        status: 'completed',
        parentChatId: '22222222-2222-2222-2222-222222222222',
        parentToolCallId: null,
        parentTurnId: null,
        summary: 'done',
        structuredOutcome: null,
        budgetEvents: [],
        error: null,
        startedAt: null,
        endedAt: null,
        toolTurns: 0,
        cancelled: false,
        messages: [],
      } satisfies SubAgentRun,
    ]);
    assert.equal(
      isSubAgentResumeUserMessage({ role: 'user', content: completion }),
      true,
    );
    assert.equal(
      isSubAgentResumeUserMessage({
        role: 'user',
        content: '[Sub-agent check-in] Sub-agent `explore` has run 120s and has not finished yet.',
      }),
      true,
    );
    assert.equal(
      isSubAgentResumeUserMessage({ role: 'user', content: 'Hello there' }),
      false,
    );
  });

  test('hiddenFromTranscript flag hides programmatic resume rows', () => {
    const row = hiddenTranscriptUserMessage('internal resume');
    assert.equal(isHiddenTranscriptUserMessage(row), true);
  });

  test('legacy sub-agent rows without hiddenFromTranscript still hide via prefix', () => {
    assert.equal(
      isHiddenTranscriptUserMessage({
        role: 'user',
        content: '[Sub-agent finished] One sub-agent run completed.',
      }),
      true,
    );
  });
});
