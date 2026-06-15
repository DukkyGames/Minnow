/**
 * Dictation range merge tests for live composer STT.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DictationRange } from '../../src/voice/dictation-range.ts';

function makeTextarea(initial: string, start: number, end = start): HTMLTextAreaElement {
  const el = {
    value: initial,
    selectionStart: start,
    selectionEnd: end,
    setSelectionRange(startPos: number, _endPos: number) {
      this.selectionStart = startPos;
      this.selectionEnd = startPos;
    },
  } as HTMLTextAreaElement;
  return el;
}

describe('dictation-range', () => {
  test('start anchors caret and preserves surrounding text', () => {
    const input = makeTextarea('Hello world', 11);
    const range = new DictationRange();
    range.start(input);
    range.applySegment('again');
    range.render(input);
    assert.equal(input.value, 'Hello world again');
    assert.equal(input.selectionStart, 'Hello world again'.length);
  });

  test('applySegment joins committed segments with spacing', () => {
    const input = makeTextarea('', 0);
    const range = new DictationRange();
    range.start(input);
    range.applySegment('Hello');
    range.applySegment('world');
    range.render(input);
    assert.equal(input.value, 'Hello world');
  });

  test('setFinal replaces dictation span', () => {
    const input = makeTextarea('Prefix ', 7);
    const range = new DictationRange();
    range.start(input);
    range.applySegment('partial');
    range.setFinal('final text');
    range.render(input);
    assert.equal(input.value, 'Prefix final text');
  });

  test('restore reverts to pre-dictation value', () => {
    const input = makeTextarea('Keep me', 4);
    const range = new DictationRange();
    range.start(input);
    range.applySegment('changed');
    range.restore(input);
    assert.equal(input.value, 'Keep me');
    assert.equal(input.selectionStart, 4);
  });
});
