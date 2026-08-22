/**
 * Archive collapse must address history rows, not API positions.
 *
 * `buildApiMessages` drops UI-only transcript rows (`context` / `injection`), so
 * the old `history index i lives at API index systemEnd + i` assumption shifted by
 * one for every skipped row — collapsing live turns into a placeholder while the
 * transcript on screen still showed them.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { replaceArchivedRangesWithPlaceholder } from '../../../src/chat/archive/collapse.ts';
import { buildApiMessages } from '../../../src/tools/loop.ts';
import type { ApiMessage, Chat, Message } from '../../../src/types.ts';

function makeChat(history: Message[]): Chat {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Drift',
    workspacePath: '',
    modelId: 'test-model',
    modeId: 'build',
    history,
    historyLoaded: true,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    lastMessageAt: 1,
  } as Chat;
}

function textOf(message: ApiMessage): string {
  return typeof message.content === 'string' ? message.content : '';
}

describe('archive collapse index drift', () => {
  test('a UI-only row does not shift the collapse window onto a live turn', () => {
    // The notice sits inside the archived turn, so it costs a history index the
    // API message list never spent. Walking positionally overruns by exactly that
    // much and eats the first live message.
    const history: Message[] = [
      { role: 'user', content: 'old question' },
      { role: 'context', content: 'files attached' } as unknown as Message,
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'live question' },
      { role: 'assistant', content: 'live answer' },
    ];
    const messages = buildApiMessages(makeChat(history), 'sys', { modelId: 'test-model' });

    // Archive only the first turn (history rows 0-2).
    const { messages: out, archived } = replaceArchivedRangesWithPlaceholder(
      messages,
      [{ startIndex: 0, endIndex: 3, sourceTurnIndices: [0, 2] }],
      history.length,
    );

    assert.equal(archived, 1);
    const bodies = out.map(textOf);
    assert.equal(
      bodies.some((t) => t.startsWith('<archived_context')),
      true,
      'the archived turn is replaced by a placeholder',
    );
    assert.equal(bodies.includes('old question'), false);
    assert.equal(bodies.includes('old answer'), false);
    assert.equal(bodies.includes('live question'), true, 'the live turn must survive');
    assert.equal(bodies.includes('live answer'), true, 'the live turn must survive');
  });

  test('a tool result stays with the assistant row that called it', () => {
    const history: Message[] = [
      { role: 'user', content: 'old question' },
      { role: 'injection', content: 'memory notice' } as unknown as Message,
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      } as unknown as Message,
      { role: 'tool', tool_call_id: 'c1', content: 'file body' } as unknown as Message,
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'live question' },
    ];
    const messages = buildApiMessages(makeChat(history), 'sys', { modelId: 'test-model' });

    const { messages: out } = replaceArchivedRangesWithPlaceholder(
      messages,
      [{ startIndex: 0, endIndex: 5, sourceTurnIndices: [0, 2, 3, 4] }],
      history.length,
    );

    const bodies = out.map(textOf);
    assert.equal(
      out.some((m) => m.role === 'tool'),
      false,
      'the archived turn takes its tool result with it',
    );
    assert.equal(bodies.includes('live question'), true);
  });
});
