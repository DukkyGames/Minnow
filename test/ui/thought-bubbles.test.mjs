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
  wrap.innerHTML = '<div class="msg-label">Assistant</div><div class="msg-bubble"></div>';
  return wrap;
}

describe('ThoughtBubbleController', { concurrency: false }, () => {
  test('queued deltas after a paragraph boundary resolve without hanging', async () => {
    setupDom();
    const wrap = assistantWrap();
    const ctrl = new ThoughtBubbleController(wrap);

    ctrl.appendReasoningDelta('First thought');
    ctrl.appendReasoningDelta('\n\n');
    ctrl.appendReasoningDelta('Second thought');

    await Promise.race([
      ctrl.flushPendingWork(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('reasoning queue hung')), 2500),
      ),
    ]);

    assert.deepEqual(ctrl.getSegmentsNormalized(), [
      'First thought',
      'Second thought',
    ]);

    ctrl.endReasoningPhase();
  });
});

describe('renderThoughtsToggle', () => {
  test('durationMs updates button label', () => {
    setupDom();
    const wrap = assistantWrap();
    renderThoughtsToggle(wrap, ['Segment one'], { durationMs: 5000 });
    const btn = wrap.querySelector('.thoughts-toggle');
    assert.equal(btn?.textContent, 'Thought for 5.0s');
    assert.equal(btn?.getAttribute('aria-label'), 'Thought for 5.0s');
  });
});
