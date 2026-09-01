/**
 * Expert chats are the reason the P6 chat path needs the leading-assistant fold.
 *
 * `createExpertChatFromSeed` pushes the authored greeting into `chat.history`
 * before the user has said anything, so the first model-facing row of an expert
 * chat is `assistant`. `buildApiMessages` used to fold that preamble into the
 * system message on every send; `runTurn({ seedKind: 'continue' })` reads
 * `chat.history` through `createSessionTranscriptStore` instead, so the fold
 * moved into `buildOpeningTranscript`.
 *
 * This suite pins the trigger (the seeded row) to the fix (the opening), so a
 * change to how experts greet cannot silently strand the runner-side fold.
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  createExpertChatFromSeed,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import { createSessionTranscriptStore } from '../../src/agents/session-transcript-store.ts';
import { buildOpeningTranscript } from '../../server/runner/index.js';

const GREETING = 'Hi — I am **Security reviewer**. What should we look at?';

function seedExpertChat() {
  setSessionStateForTests({
    version: 3,
    activeId: '',
    sidebarCollapsed: false,
    chats: [],
  });
  return createExpertChatFromSeed({
    expertId: 'security-reviewer',
    modelId: 'm1',
    modeId: 'general',
    workspacePath: 'C:/tmp/ws',
    greeting: GREETING,
    runtimeSnapshot: {
      modelId: 'm1',
      modeId: 'general',
      toolAllowlist: null,
      toolDenylist: [],
      enabledToolNames: [],
      memoryEnabled: true,
      warnings: [],
      profileSource: 'inherit',
    },
  });
}

describe('expert greeting reaches the runner as a system preamble', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('the seeded chat really does open on an assistant row', () => {
    const chat = seedExpertChat();

    assert.equal(chat.history[0]?.role, 'assistant');
    // The transcript store is model-facing and must not hide it — dropping the
    // greeting here would desync `runTurn`'s persist boundary instead.
    const loaded = createSessionTranscriptStore().load(chat.id);
    assert.equal(loaded?.messages[0]?.role, 'assistant');
  });

  test('the opening folds it away and still points persist past the stored rows', () => {
    const chat = seedExpertChat();
    // Chat pushes the user row before calling runTurn.
    chat.history.push({ role: 'user', content: 'audit the login flow' });

    const prior = createSessionTranscriptStore().load(chat.id)?.messages ?? [];
    const opened = buildOpeningTranscript(
      'You are Security reviewer.',
      'audit the login flow',
      prior,
    );

    assert.equal(opened.messages.length, 2);
    assert.equal((opened.messages[0] as { role: string }).role, 'system');
    assert.match(
      (opened.messages[0] as { content: string }).content,
      /already greeted the user in the UI/,
    );
    assert.match((opened.messages[0] as { content: string }).content, /Security reviewer/);
    assert.equal(
      (opened.messages[1] as { role: string }).role,
      'user',
      'the conversation must open on a user turn',
    );
    // Both stored rows are accounted for, so nothing this turn produces is skipped.
    assert.equal(opened.persistFrom, opened.messages.length);
    assert.equal(prior.length, 2);
  });
});
