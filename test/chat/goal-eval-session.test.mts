import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  finishGoalEvalSession,
  getGoalEvalSession,
  patchGoalEvalSession,
  resetGoalEvalSessionsForTests,
  startGoalEvalSession,
  subscribeGoalEvalSessions,
} from '../../src/chat/goal/eval-session.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const CONDITION = 'all unit tests pass';

describe('goal eval session', () => {
  afterEach(() => {
    resetGoalEvalSessionsForTests();
  });

  test('startGoalEvalSession creates a running session per chat', () => {
    const session = startGoalEvalSession(CHAT_ID, CONDITION);
    assert.equal(session.chatId, CHAT_ID);
    assert.equal(session.conditionText, CONDITION);
    assert.equal(session.status, 'running');
    assert.deepEqual(session.messages, []);
    assert.equal(getGoalEvalSession(CHAT_ID), session);
  });

  test('patchGoalEvalSession updates live fields and notifies subscribers', () => {
    startGoalEvalSession(CHAT_ID, CONDITION);
    const seen: string[] = [];
    subscribeGoalEvalSessions((session) => {
      seen.push(session.liveCurrentToolName ?? '');
    });

    patchGoalEvalSession(CHAT_ID, {
      messages: [{ role: 'assistant', content: 'checking' }],
      liveCurrentToolName: 'read_file',
      verificationToolCalls: 1,
    });

    const session = getGoalEvalSession(CHAT_ID);
    assert.equal(session?.messages.length, 1);
    assert.equal(session?.liveCurrentToolName, 'read_file');
    assert.equal(session?.verificationToolCalls, 1);
    assert.deepEqual(seen, ['read_file']);
  });

  test('finishGoalEvalSession marks the session completed with verdict', () => {
    startGoalEvalSession(CHAT_ID, CONDITION);
    finishGoalEvalSession(CHAT_ID, {
      met: false,
      reason: 'Not yet.',
      rawVerdict: 'NO: Not yet.',
      verificationToolCalls: 2,
    });

    const session = getGoalEvalSession(CHAT_ID);
    assert.equal(session?.status, 'completed');
    assert.equal(session?.met, false);
    assert.equal(session?.reason, 'Not yet.');
    assert.equal(session?.rawVerdict, 'NO: Not yet.');
    assert.equal(session?.verificationToolCalls, 2);
    assert.equal(session?.liveCurrentToolName, undefined);
    assert.ok(session?.endedAt);
  });
});
