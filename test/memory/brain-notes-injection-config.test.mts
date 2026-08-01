/**
 * Brain notes injection tri-state + global default resolution.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveBrainNotesInjectionEnabled,
  resolveBrainNotesInjectionTriState,
} from '../../src/memory/config.ts';
import type { Chat } from '../../src/types.ts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';

function baseChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Test',
    modelId: 'm',
    history: [],
    updatedAt: 1,
    workspacePath: '',
    ...overrides,
  };
}

describe('resolveBrainNotesInjectionEnabled', () => {
  it('inherit follows global default off', () => {
    const chat = baseChat();
    assert.equal(resolveBrainNotesInjectionEnabled(chat, false), false);
  });

  it('inherit follows global default on', () => {
    const chat = baseChat();
    assert.equal(resolveBrainNotesInjectionEnabled(chat, true), true);
  });

  it('chat on overrides global off', () => {
    const chat = baseChat({ brainNotesInjection: 'on' });
    assert.equal(resolveBrainNotesInjectionEnabled(chat, false), true);
  });

  it('chat off overrides global on', () => {
    const chat = baseChat({ brainNotesInjection: 'off' });
    assert.equal(resolveBrainNotesInjectionEnabled(chat, true), false);
  });
});

describe('resolveBrainNotesInjectionTriState', () => {
  it('defaults to inherit', () => {
    assert.equal(resolveBrainNotesInjectionTriState(baseChat()), 'inherit');
  });

  it('reads chat override', () => {
    assert.equal(
      resolveBrainNotesInjectionTriState(baseChat({ brainNotesInjection: 'off' })),
      'off',
    );
  });
});
