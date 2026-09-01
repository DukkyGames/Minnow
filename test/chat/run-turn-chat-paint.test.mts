/**
 * P6-A onEvent → existing chat DOM helpers.
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  coerceToolCallArgs,
  createChatTurnEventPainter,
  thinkingDeltaFromSnapshot,
} from '../../src/chat/run-turn-chat-paint.ts';

function hostStub() {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant msg--awaiting-prose';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  const cursor = document.createElement('div');
  wrap.appendChild(bubble);
  bubble.appendChild(cursor);
  mount.appendChild(wrap);
  const thinking: string[] = [];
  let revealed = false;
  const activity: string[] = [];
  return {
    mount,
    wrap,
    bubble,
    cursor,
    thinking,
    get revealed() {
      return revealed;
    },
    activity,
    host: {
      wrap,
      bubble,
      cursor,
      thoughtController: {
        appendReasoningDelta: (delta: string) => {
          thinking.push(delta);
        },
      },
      mount,
      revealProse: () => {
        revealed = true;
      },
      onActivity: () => {
        activity.push('tick');
      },
    },
  };
}

describe('P6-A chat turn event painter (MIN-723)', () => {
  test('thinkingDeltaFromSnapshot diffs a cumulative snapshot', () => {
    assert.equal(thinkingDeltaFromSnapshot('', 'abc'), 'abc');
    assert.equal(thinkingDeltaFromSnapshot('ab', 'abcd'), 'cd');
    assert.equal(thinkingDeltaFromSnapshot('xy', 'ab'), 'ab');
  });

  test('coerceToolCallArgs parses a JSON string from the wire', () => {
    assert.deepEqual(coerceToolCallArgs('{"expression":"1+1"}'), { expression: '1+1' });
    assert.deepEqual(coerceToolCallArgs({ expression: '1+1' }), { expression: '1+1' });
  });

  test('maps delta, thinking, tool_call, and tool_result onto existing helpers', () => {
    const stub = hostStub();
    const painter = createChatTurnEventPainter(stub.host);

    painter.onEvent({ type: 'thinking', text: 'Let me look.' });
    painter.onEvent({ type: 'thinking', text: 'Let me look. Then call.' });
    painter.onEvent({ type: 'delta', text: 'The time is ' });
    painter.onEvent({ type: 'delta', text: 'The time is noon.' });
    painter.onEvent({
      type: 'tool_call',
      name: 'get_datetime',
      id: 'call_dt',
      arguments: '{}',
    });
    painter.onEvent({
      type: 'tool_result',
      name: 'get_datetime',
      id: 'call_dt',
      content: '2026-08-31T12:00:00.000Z',
    });

    const snap = painter.snapshot();
    assert.equal(snap.lastDelta, 'The time is noon.');
    assert.equal(snap.lastThinking, 'Let me look. Then call.');
    assert.equal(snap.toolCallCount, 1);
    assert.equal(stub.revealed, true);
    assert.deepEqual(stub.thinking, ['Let me look.', ' Then call.']);
    const toolRow = stub.mount.querySelector('.tool-call-msg');
    assert.ok(toolRow, 'tool_call must append a .tool-call-msg row');
    // `renderToolResult` removes aria-busy rather than setting it to "false".
    assert.equal(toolRow?.hasAttribute('aria-busy'), false);
    assert.ok(
      stub.mount.textContent?.includes('2026-08-31T12:00:00.000Z') ||
        toolRow?.textContent?.includes('2026-08-31'),
      'tool_result must fill the existing tool row',
    );
    assert.ok(stub.activity.length >= 4);
  });

  test('tool_streaming shows Calling… and retarget keeps it across remount', () => {
    const stub = hostStub();
    const streamStatus = {
      setPhase() {},
      setThinkingElapsed() {},
      setRuntimeDetail() {},
      dispose() {},
    };
    const painter = createChatTurnEventPainter({
      ...stub.host,
      streamStatus,
    });

    painter.onEvent({ type: 'tool_streaming', name: 'get_datetime' });
    const firstLabel = stub.wrap.querySelector('.tool-start-indicator__label')?.textContent;
    assert.ok(firstLabel?.startsWith('Calling '), `got ${firstLabel}`);

    const wrap2 = document.createElement('div');
    wrap2.className = 'msg assistant';
    const bubble2 = document.createElement('div');
    bubble2.className = 'msg-bubble';
    const cursor2 = document.createElement('div');
    wrap2.appendChild(bubble2);
    bubble2.appendChild(cursor2);
    stub.mount.appendChild(wrap2);

    painter.retarget({ wrap: wrap2, bubble: bubble2, cursor: cursor2, streamStatus });
    const remountLabel = wrap2.querySelector('.tool-start-indicator__label')?.textContent;
    assert.equal(remountLabel, firstLabel);

    painter.onEvent({
      type: 'tool_call',
      name: 'get_datetime',
      id: 'call_dt',
      arguments: '{}',
    });
    assert.equal(wrap2.querySelector('.tool-start-indicator'), null);
  });
});
