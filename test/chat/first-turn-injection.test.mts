/**
 * First-turn injection gating for Brain notes, code map, and context documents.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { shouldRunFirstTurnInjections } from '../../src/chat/prompts/first-turn-injection.ts';
import type { Chat } from '../../src/types.ts';

function chatWithHistory(roles: Array<'user' | 'assistant'>): Chat {
  return {
    id: 'c1',
    name: 'Test',
    history: roles.map((role) =>
      role === 'user'
        ? { role: 'user', content: 'hi' }
        : { role: 'assistant', content: 'ok' },
    ),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('shouldRunFirstTurnInjections', () => {
  test('runs when no user messages yet (token estimate path)', () => {
    const chat = chatWithHistory([]);
    assert.equal(shouldRunFirstTurnInjections(chat), true);
  });

  test('skips after first user message without firstUserSend flag', () => {
    const chat = chatWithHistory(['user']);
    assert.equal(shouldRunFirstTurnInjections(chat), false);
  });

  test('firstUserSend true forces inject even with user in history', () => {
    const chat = chatWithHistory(['user']);
    assert.equal(shouldRunFirstTurnInjections(chat, { firstUserSend: true }), true);
  });

  test('firstUserSend false forces skip on pending first user', () => {
    const chat = chatWithHistory([]);
    assert.equal(shouldRunFirstTurnInjections(chat, { firstUserSend: false }), false);
  });
});
