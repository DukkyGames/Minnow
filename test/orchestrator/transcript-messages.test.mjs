/**
 * TurnEvent JSONL → API-message mapper used by the sub-agent drawer
 * and continue-seed hydrate. Pure: no I/O.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyTurnEventToMessages,
  countToolCalls,
  turnEventsToMessages,
} from '../../server/orchestrator/transcript-messages.js';

describe('turnEventsToMessages', () => {
  test('maps tool_call + tool_result + round_end onto API messages', () => {
    const messages = turnEventsToMessages([
      { type: 'delta', text: 'ignored' },
      { type: 'phase', phase: 'tools' },
      {
        type: 'tool_call',
        name: 'read_file',
        id: 'call_read',
        arguments: { path: 'src/a.ts' },
      },
      { type: 'tool_result', id: 'call_read', content: 'export const a = 1;' },
      { type: 'round_end', text: 'Here is what I found in src/.' },
    ]);
    assert.equal(messages.length, 3);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].tool_calls[0].id, 'call_read');
    assert.equal(messages[0].tool_calls[0].function.name, 'read_file');
    assert.equal(messages[1].role, 'tool');
    assert.equal(messages[1].tool_call_id, 'call_read');
    assert.equal(messages[1].content, 'export const a = 1;');
    assert.equal(messages[2].role, 'assistant');
    assert.equal(messages[2].content, 'Here is what I found in src/.');
    assert.equal(countToolCalls(messages), 1);
  });

  test('skips high-frequency types and empty round_end', () => {
    const messages = turnEventsToMessages([
      { type: 'delta', text: 'tok' },
      { type: 'round_end', text: '   ' },
    ]);
    assert.deepEqual(messages, []);
  });

  test('maps coalesced thinking onto assistant reasoning', () => {
    const messages = turnEventsToMessages([
      { type: 'thinking', text: 'I should look at src/ next.' },
    ]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].reasoning, 'I should look at src/ next.');
  });

  test('maps attempt_end summary when no later prose exists', () => {
    const messages = turnEventsToMessages([
      { type: 'thinking', text: 'file looks small' },
      {
        type: 'tool_call',
        name: 'read_file',
        id: 'call_read',
        arguments: { path: 'src/a.ts' },
      },
      { type: 'tool_result', id: 'call_read', content: 'export const a = 1;' },
      { type: 'attempt_end', name: 'pass', summary: 'Here is what I found in src/.' },
    ]);
    assert.equal(messages.length, 4);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].reasoning, 'file looks small');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].tool_calls[0].id, 'call_read');
    assert.equal(messages[2].role, 'tool');
    assert.equal(messages[3].role, 'assistant');
    assert.equal(messages[3].content, 'Here is what I found in src/.');
  });

  test('attempt_end does not overwrite existing assistant prose', () => {
    const messages = turnEventsToMessages([
      { type: 'round_end', text: 'Already wrote this.' },
      { type: 'attempt_end', name: 'pass', summary: 'ignored duplicate' },
    ]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Already wrote this.');
  });

  test('applyTurnEventToMessages is additive', () => {
    const first = applyTurnEventToMessages([], {
      type: 'tool_call',
      name: 'grep',
      id: 'call_grep',
    });
    const second = applyTurnEventToMessages(first, {
      type: 'tool_result',
      id: 'call_grep',
      content: 'no matches',
    });
    assert.equal(first.length, 1);
    assert.equal(second.length, 2);
  });
});
