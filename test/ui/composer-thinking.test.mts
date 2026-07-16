import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import {
  nextThinkingTriStateOnClick,
  syncThinkingControlFromActiveChat,
} from '../../src/ui/composer-thinking.ts';

describe('nextThinkingTriStateOnClick', () => {
  test('from inherit with resolved on sets off', () => {
    assert.equal(nextThinkingTriStateOnClick('inherit', 'on'), 'off');
  });

  test('from inherit with resolved off sets on', () => {
    assert.equal(nextThinkingTriStateOnClick('inherit', 'off'), 'on');
  });

  test('from explicit on sets off', () => {
    assert.equal(nextThinkingTriStateOnClick('on', 'on'), 'off');
  });

  test('from explicit off returns to inherit', () => {
    assert.equal(nextThinkingTriStateOnClick('off', 'off'), 'inherit');
    assert.equal(nextThinkingTriStateOnClick('off', 'on'), 'inherit');
  });
});

describe('syncThinkingControlFromActiveChat', () => {
  test('does not throw before sessions are loaded', () => {
    setSessionStateForTests(null);
    assert.doesNotThrow(() => syncThinkingControlFromActiveChat());
  });
});
