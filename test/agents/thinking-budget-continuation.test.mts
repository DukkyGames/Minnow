import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ThinkingBudgetTracker,
  buildBudgetContinuationMessages,
  stripCarriedTextEcho,
  thinkingBudgetGraceTokens,
  THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION,
} from '../../src/agents/thinking-budget.ts';

/**
 * `estimateTokensFromText` is chars ÷ 4, so N tokens of filler is 4N chars.
 * Each call uses a different character so one run is never a prefix of the next —
 * the tracker treats a prefix-extending delta as a cumulative resend.
 */
let fillerRun = 0;
function tokens(count: number): string {
  const char = String.fromCharCode(97 + fillerRun++ % 26);
  return char.repeat(count * 4);
}

describe('ThinkingBudgetTracker turn accounting', () => {
  test('accumulates across endSession and trips on the turn total', () => {
    const tracker = new ThinkingBudgetTracker(100);

    tracker.feed(tokens(60));
    assert.equal(tracker.exceeded, false);
    assert.equal(tracker.spentTokens, 60);

    tracker.endSession();
    assert.equal(tracker.exceeded, false);
    assert.equal(tracker.sessionText, '');
    // The phase text is gone but the turn total is not.
    assert.equal(tracker.spentTokens, 60);

    // A second phase that would be well under the limit on its own still trips.
    tracker.feed(tokens(45));
    assert.equal(tracker.exceeded, true);
    assert.equal(tracker.nudgeCount, 1);
    assert.equal(tracker.spentTokens, 105);
  });

  test('sessionText carries only the phase that tripped', () => {
    const tracker = new ThinkingBudgetTracker(50);
    tracker.feed('first phase');
    tracker.endSession();
    tracker.feed(`second phase ${tokens(50)}`);
    assert.equal(tracker.exceeded, true);
    assert.match(tracker.sessionText, /^second phase /);
    assert.ok(!tracker.sessionText.includes('first phase'));
  });

  test('cumulative resend deltas replace instead of double-counting', () => {
    const tracker = new ThinkingBudgetTracker(20);
    tracker.feed('abcd');
    tracker.feed('abcdefgh');
    tracker.feed('abcdefghijkl');
    assert.equal(tracker.exceeded, false);
    assert.equal(tracker.spentTokens, 3);
    assert.equal(tracker.sessionText, 'abcdefghijkl');
  });

  test('cumulative resend still counts against banked phases', () => {
    const tracker = new ThinkingBudgetTracker(30);
    tracker.feed(tokens(25));
    tracker.endSession();
    tracker.feed('abcd');
    tracker.feed(`abcd${tokens(5)}`);
    assert.equal(tracker.spentTokens, 31);
    assert.equal(tracker.exceeded, true);
  });
});

describe('ThinkingBudgetTracker continuation control', () => {
  test('beginContinuation clears the trip and grants exactly the grace', () => {
    const tracker = new ThinkingBudgetTracker(100);
    tracker.feed(tokens(100));
    assert.equal(tracker.exceeded, true);

    tracker.beginContinuation(40);
    assert.equal(tracker.exceeded, false);
    assert.equal(tracker.sessionText, '');
    assert.equal(tracker.spentTokens, 100);

    // 39 more tokens stays inside 100 + 40 grace…
    tracker.feed(tokens(39));
    assert.equal(tracker.exceeded, false);
    // …and the 40th trips again.
    tracker.feed(tokens(1));
    assert.equal(tracker.exceeded, true);
    assert.equal(tracker.nudgeCount, 2);
  });

  test('default grace is the greater of 256 tokens and a quarter of the budget', () => {
    assert.equal(thinkingBudgetGraceTokens(200), 256);
    assert.equal(thinkingBudgetGraceTokens(8000), 2000);

    const tracker = new ThinkingBudgetTracker(200);
    tracker.feed(tokens(200));
    tracker.beginContinuation();
    tracker.feed(tokens(255));
    assert.equal(tracker.exceeded, false);
    tracker.feed(tokens(1));
    assert.equal(tracker.exceeded, true);
  });

  test('disarm suppresses all further trips for the turn', () => {
    const tracker = new ThinkingBudgetTracker(10);
    tracker.feed(tokens(10));
    assert.equal(tracker.exceeded, true);

    tracker.disarm();
    assert.equal(tracker.exceeded, false);

    tracker.feed(tokens(500));
    assert.equal(tracker.exceeded, false);
    tracker.endSession();
    tracker.feed(tokens(500));
    assert.equal(tracker.exceeded, false);
    assert.equal(tracker.nudgeCount, 1);
    // Still counting for status text, just never tripping.
    assert.equal(tracker.spentTokens, 1010);
  });
});

describe('buildBudgetContinuationMessages', () => {
  test('carries reasoning and prose as assistant-then-user', () => {
    const msgs = buildBudgetContinuationMessages({
      partialThinking: 'step one leads to step two',
      partialText: 'The answer begins here',
    });

    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'assistant');
    assert.equal(msgs[1].role, 'user');

    const assistant = String(msgs[0].content);
    assert.match(assistant, /Reasoning so far:/);
    assert.ok(assistant.includes('step one leads to step two'));
    assert.match(assistant, /Answer written so far:/);
    assert.ok(assistant.includes('The answer begins here'));
    assert.ok(assistant.indexOf('Reasoning so far:') < assistant.indexOf('Answer written so far:'));

    const user = String(msgs[1].content);
    assert.ok(user.startsWith(THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION));
    assert.match(user, /Continue from the work above/);
    assert.match(user, /not start over/);
  });

  test('omits the section that is empty', () => {
    const thinkingOnly = buildBudgetContinuationMessages({
      partialThinking: 'only reasoning',
      partialText: '   ',
    });
    assert.equal(thinkingOnly.length, 2);
    const assistant = String(thinkingOnly[0].content);
    assert.match(assistant, /Reasoning so far:/);
    assert.ok(!assistant.includes('Answer written so far:'));

    const textOnly = buildBudgetContinuationMessages({
      partialThinking: '',
      partialText: 'partial answer',
    });
    const textAssistant = String(textOnly[0].content);
    assert.ok(!textAssistant.includes('Reasoning so far:'));
    assert.match(textAssistant, /Answer written so far:/);
  });

  test('drops the assistant message entirely when nothing was produced', () => {
    const msgs = buildBudgetContinuationMessages({ partialThinking: '', partialText: '' });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[0].content, THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION);
  });
});

describe('stripCarriedTextEcho', () => {
  test('strips a verbatim repeat and keeps the joining whitespace', () => {
    const carried = 'The first half of the answer is already on screen.';
    const delta = `${carried} And here is the rest.`;
    assert.equal(stripCarriedTextEcho(delta, carried), ' And here is the rest.');
  });

  test('strips a repeat that arrives with leading whitespace', () => {
    const carried = 'Answer part one.';
    assert.equal(stripCarriedTextEcho(`\n\n${carried}\nPart two.`, carried), '\nPart two.');
  });

  test('drops a first delta that only re-emits the start of the carried prose', () => {
    const carried = 'The first half of the answer is already on screen and continues.';
    assert.equal(stripCarriedTextEcho(carried.slice(0, 45), carried), '');
  });

  test('leaves an unrelated continuation untouched', () => {
    const carried = 'The first half of the answer is already on screen.';
    const delta = ' Continuing from there, the remaining steps are:';
    assert.equal(stripCarriedTextEcho(delta, carried), delta);
  });

  test('leaves a short coincidental overlap untouched', () => {
    const carried = 'The plan is simple and short.';
    assert.equal(stripCarriedTextEcho('The plan', carried), 'The plan');
  });

  test('no carried text is a pass-through', () => {
    assert.equal(stripCarriedTextEcho('hello', ''), 'hello');
    assert.equal(stripCarriedTextEcho('', 'carried'), '');
  });
});
