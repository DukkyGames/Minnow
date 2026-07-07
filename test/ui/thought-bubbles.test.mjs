import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { ThoughtBubbleController, renderThoughtsToggle } = await import(
  '../../src/ui/thought-bubbles.ts'
);

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);
  return window;
}

function assistantWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.innerHTML =
    '<div class="msg-label">Assistant</div><div class="stream-status"></div><div class="msg-bubble"></div>';
  return wrap;
}

describe('ThoughtBubbleController', { concurrency: false }, () => {
  test('reasoning prose is collapsed by default during streaming', () => {
    setupDom();
    const wrap = assistantWrap();
    const ctrl = new ThoughtBubbleController(wrap);

    ctrl.appendReasoningDelta('Hidden reasoning text');

    const flow = wrap.querySelector('.thoughts-flow');
    const toggle = wrap.querySelector('.thoughts-toggle');
    const segment = wrap.querySelector('.thoughts-segment');

    assert.ok(toggle);
    assert.equal(toggle?.getAttribute('aria-expanded'), 'false');
    assert.ok(flow?.hidden);
    assert.equal(segment?.textContent, '');
    assert.ok(wrap.querySelector('.stream-status')?.classList.contains('hidden'));

    ctrl.endReasoningPhase();
  });

  test('click expands to reveal streaming reasoning text', () => {
    setupDom();
    const wrap = assistantWrap();
    const ctrl = new ThoughtBubbleController(wrap);

    ctrl.appendReasoningDelta('Visible when expanded');

    const toggle = wrap.querySelector('.thoughts-toggle');
    toggle?.click();

    const flow = wrap.querySelector('.thoughts-flow');
    const segment = wrap.querySelector('.thoughts-segment');

    assert.equal(toggle?.getAttribute('aria-expanded'), 'true');
    assert.equal(flow?.hidden, false);
    assert.equal(segment?.textContent, 'Visible when expanded');

    toggle?.click();
    assert.equal(toggle?.getAttribute('aria-expanded'), 'false');
    assert.ok(flow?.hidden);

    ctrl.endReasoningPhase();
  });

  test('paragraph boundaries split stored segments', async () => {
    setupDom();
    const wrap = assistantWrap();
    const ctrl = new ThoughtBubbleController(wrap);

    ctrl.appendReasoningDelta('First thought');
    ctrl.appendReasoningDelta('\n\n');
    ctrl.appendReasoningDelta('Second thought');

    await ctrl.flushPendingWork();

    assert.deepEqual(ctrl.getSegmentsNormalized(), [
      'First thought',
      'Second thought',
    ]);

    ctrl.endReasoningPhase();
  });

  test('setThinkingElapsed updates live toggle label', () => {
    setupDom();
    const wrap = assistantWrap();
    const ctrl = new ThoughtBubbleController(wrap);

    ctrl.appendReasoningDelta('Reasoning');
    ctrl.setThinkingElapsed(5000);

    const label = wrap.querySelector('.thoughts-toggle__label');
    assert.equal(label?.textContent, 'Thinking… 5.0s');

    ctrl.endReasoningPhase();
  });
});

describe('renderThoughtsToggle', () => {
  test('durationMs updates button label and starts collapsed', () => {
    setupDom();
    const wrap = assistantWrap();
    renderThoughtsToggle(wrap, ['Segment one'], { durationMs: 5000 });
    const btn = wrap.querySelector('.thoughts-toggle');
    const flow = wrap.querySelector('.thoughts-flow');
    assert.equal(btn?.querySelector('.thoughts-toggle__label')?.textContent, 'Thought for 5.0s');
    assert.equal(btn?.getAttribute('aria-label'), 'Thought for 5.0s');
    assert.equal(btn?.getAttribute('aria-expanded'), 'false');
    assert.ok(flow?.hidden);
  });

  test('click toggles persisted reasoning visibility', () => {
    setupDom();
    const wrap = assistantWrap();
    renderThoughtsToggle(wrap, ['Segment one']);
    const btn = wrap.querySelector('.thoughts-toggle');
    const flow = wrap.querySelector('.thoughts-flow');

    btn?.click();
    assert.equal(btn?.getAttribute('aria-expanded'), 'true');
    assert.equal(flow?.hidden, false);

    btn?.click();
    assert.equal(btn?.getAttribute('aria-expanded'), 'false');
    assert.ok(flow?.hidden);
  });
});
