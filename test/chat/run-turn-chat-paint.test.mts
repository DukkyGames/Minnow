/**
 * P6-A / P7-B onEvent → existing chat DOM helpers, coalesced onto one paint tick.
 */

import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  coerceToolCallArgs,
  createChatTurnEventPainter,
  thinkingDeltaFromSnapshot,
} from '../../src/chat/run-turn-chat-paint.ts';

function hostStub(overrides: {
  schedulePaintTick?: (cb: () => void) => void;
  scrollTranscript?: () => void;
  scheduleMarkdown?: (
    bubble: HTMLElement,
    markdown: string,
    streamCursor: HTMLElement,
  ) => void;
} = {}) {
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
      ...overrides,
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
    // tool_call flushes pending snapshots; latest thinking wins as one append.
    assert.deepEqual(stub.thinking, ['Let me look. Then call.']);
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

describe('P7-B coalesced chat paint (MIN-729)', () => {
  test('a burst of thinking/delta events is one scroll and one markdown schedule per tick', () => {
    const ticks: Array<() => void> = [];
    let scrolls = 0;
    let markdowns = 0;
    let coalescedPaints = 0;
    const stub = hostStub({
      schedulePaintTick: (cb) => {
        ticks.push(cb);
      },
      scrollTranscript: () => {
        scrolls += 1;
      },
      scheduleMarkdown: () => {
        markdowns += 1;
      },
    });
    const painter = createChatTurnEventPainter({
      ...stub.host,
      onCoalescedPaint: () => {
        coalescedPaints += 1;
      },
    });

    const burst = 20;
    for (let i = 1; i <= burst; i += 1) {
      painter.onEvent({ type: 'thinking', text: 'x'.repeat(i) });
      painter.onEvent({ type: 'delta', text: 'y'.repeat(i) });
    }

    assert.equal(ticks.length, 1, 'one rAF scheduled for the burst');
    assert.equal(scrolls, 0, 'no scroll before the paint tick');
    assert.equal(markdowns, 0, 'no markdown schedule before the paint tick');
    assert.deepEqual(stub.thinking, []);
    assert.equal(stub.revealed, false);

    ticks[0]();

    assert.equal(scrolls, 1);
    assert.equal(markdowns, 1);
    assert.equal(coalescedPaints, 1, 'live stats hook fires once per paint tick');
    assert.deepEqual(stub.thinking, ['x'.repeat(burst)]);
    assert.equal(stub.revealed, true);
    assert.equal(painter.snapshot().lastDelta, 'y'.repeat(burst));
    assert.equal(painter.snapshot().lastThinking, 'x'.repeat(burst));
  });

  test('thinking prefix-diffs against the last painted snapshot across ticks', () => {
    const ticks: Array<() => void> = [];
    const stub = hostStub({
      schedulePaintTick: (cb) => {
        ticks.push(cb);
      },
      scrollTranscript: () => {},
      scheduleMarkdown: () => {},
    });
    const painter = createChatTurnEventPainter(stub.host);

    painter.onEvent({ type: 'thinking', text: 'Let me' });
    ticks[0]();
    assert.deepEqual(stub.thinking, ['Let me']);

    painter.onEvent({ type: 'thinking', text: 'Let me look.' });
    painter.onEvent({ type: 'thinking', text: 'Let me look. Then call.' });
    assert.equal(ticks.length, 2);
    ticks[1]();
    assert.deepEqual(stub.thinking, ['Let me', ' look. Then call.']);
  });

  test('tool_call still paints immediately without waiting for a paint tick', () => {
    const ticks: Array<() => void> = [];
    const stub = hostStub({
      schedulePaintTick: (cb) => {
        ticks.push(cb);
      },
      scrollTranscript: () => {},
      scheduleMarkdown: () => {},
    });
    const painter = createChatTurnEventPainter(stub.host);

    painter.onEvent({
      type: 'tool_call',
      name: 'get_datetime',
      id: 'call_now',
      arguments: '{}',
    });

    assert.equal(ticks.length, 0, 'tools do not schedule a transcript paint');
    assert.ok(stub.mount.querySelector('.tool-call-msg'), 'tool row appears immediately');
  });
});
