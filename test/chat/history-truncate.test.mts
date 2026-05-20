import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  expandAtomicRange,
  findToolResultRange,
  normalizeHistoryTail,
  sliceHistoryAtTurn,
} from '../../src/chat/history-truncate-core.ts';
import type { Message } from '../../src/types.ts';

function toolChainHistory(): Message[] {
  return [
    { role: 'user', content: 'run tools' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_a',
          type: 'function',
          function: { name: 'get_datetime', arguments: '{}' },
        },
        {
          id: 'call_b',
          type: 'function',
          function: { name: 'calculate', arguments: '{"expr":"1+1"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_a', content: 'ok-a' },
    { role: 'tool', tool_call_id: 'call_b', content: 'ok-b' },
    { role: 'assistant', content: 'Done.' },
    { role: 'user', content: 'follow up' },
  ];
}

describe('history-truncate', () => {
  test('expandAtomicRange includes tool tail for assistant tool_calls', () => {
    const history = toolChainHistory();
    const range = expandAtomicRange(history, 1);
    assert.equal(range.start, 1);
    assert.equal(range.end, 3);
  });

  test('expandAtomicRange snaps tool index to parent assistant', () => {
    const history = toolChainHistory();
    const range = expandAtomicRange(history, 2);
    assert.equal(range.start, 1);
    assert.equal(range.end, 3);
  });

  test('sliceHistoryAtTurn inclusive at user keeps user row only', () => {
    const next = sliceHistoryAtTurn(toolChainHistory(), 0, 'inclusive');
    assert.equal(next.length, 1);
    assert.equal(next[0].role, 'user');
  });

  test('sliceHistoryAtTurn exclusive at assistant removes block and after', () => {
    const next = sliceHistoryAtTurn(toolChainHistory(), 1, 'exclusive');
    assert.equal(next.length, 1);
    assert.equal(next[0].content, 'run tools');
  });

  test('normalizeHistoryTail drops incomplete tool chain', () => {
    const history: Message[] = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'get_datetime', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_x', content: 'partial only' },
    ];
    history.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_y',
          type: 'function',
          function: { name: 'calculate', arguments: '{}' },
        },
      ],
    });
    normalizeHistoryTail(history);
    assert.equal(history.length, 3);
    assert.equal(history[0].role, 'user');
    assert.equal(history[1].role, 'assistant');
  });

  test('findToolResultRange returns assistant index when no tools yet', () => {
    const history: Message[] = [
      { role: 'user', content: 'a' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'get_datetime', arguments: '{}' },
          },
        ],
      },
    ];
    const range = findToolResultRange(history, 1);
    assert.equal(range.start, 1);
    assert.equal(range.end, 1);
  });
});
