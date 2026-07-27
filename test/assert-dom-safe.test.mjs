/**
 * The DOM-assertion guard (test/assert-dom-safe.mjs) is what keeps a failed
 * `assert.equal(el, null)` from allocating tens of GB of Myers-diff buffers and
 * freezing the machine. It is preloaded by every runner profile, so these tests
 * assert against the already-patched `assert`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { ASSERT_GUARD_IMPORT, RUNNERS } from './test-config.mjs';

function makeElement() {
  const win = new Window();
  win.document.body.innerHTML =
    '<div id="b" class="board-root live"><span class="kanban">Task A</span></div>';
  const el = win.document.querySelector('.board-root');
  return { win, el };
}

/** Run fn and return the AssertionError it throws. */
function failureOf(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the assertion to fail');
}

describe('assert-dom-safe guard', () => {
  test('every runner profile preloads the guard', () => {
    for (const [id, profile] of Object.entries(RUNNERS)) {
      const args = profile.prefixArgs;
      const at = args.indexOf(ASSERT_GUARD_IMPORT[1]);
      assert.ok(at > 0, `${id} does not preload ${ASSERT_GUARD_IMPORT[1]}`);
      assert.equal(args[at - 1], '--import', `${id} preload is not an --import`);
      assert.ok(
        at < args.indexOf('--test'),
        `${id} preloads the guard after --test`,
      );
    }
  });

  test('failed element comparison reports a short descriptor, not the node graph', () => {
    const { win, el } = makeElement();
    try {
      const err = failureOf(() => assert.equal(el, null));
      assert.equal(err.actual, '<div#b.board-root.live>');
      assert.equal(err.expected, null);
      // The whole point: bounded output. An inspected happy-dom node is megabytes.
      assert.ok(err.message.length < 500, `message was ${err.message.length} chars`);
    } finally {
      win.close();
    }
  });

  test('NodeList and Document also get descriptors', () => {
    const { win } = makeElement();
    try {
      assert.equal(
        failureOf(() => assert.equal(win.document.querySelectorAll('div'), null)).actual,
        '[NodeList length=1]',
      );
      assert.equal(
        failureOf(() => assert.equal(win.document, null)).actual,
        '[Document]',
      );
    } finally {
      win.close();
    }
  });

  test('passing DOM comparisons still pass', () => {
    const { win, el } = makeElement();
    try {
      assert.equal(el, el);
      assert.notEqual(el, null);
      assert.equal(win.document.querySelector('.missing'), null);
    } finally {
      win.close();
    }
  });

  test('a custom message survives the guard', () => {
    const { win, el } = makeElement();
    try {
      const err = failureOf(() => assert.equal(el, null, 'board should be dismissed'));
      assert.match(err.message, /board should be dismissed/);
    } finally {
      win.close();
    }
  });

  test('non-DOM assertions keep their normal diff', () => {
    assert.match(failureOf(() => assert.equal(2, 3)).message, /2 !== 3/);
    const deep = failureOf(() => assert.deepEqual({ a: [1, 2] }, { a: [1, 3] }));
    assert.match(deep.message, /actual - expected/);
  });

  test('array-likes that merely expose item() are not treated as DOM', () => {
    const arrayLike = { length: 2, item: (i) => i, 0: 'a', 1: 'b' };
    assert.deepEqual(arrayLike, { length: 2, item: arrayLike.item, 0: 'a', 1: 'b' });
  });
});
