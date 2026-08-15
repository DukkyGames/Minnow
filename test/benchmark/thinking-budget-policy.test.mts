/**
 * The watchdog must be able to trip inside the probe's wall clock.
 *
 * Regression: the budget was chat's flat 8192 tokens while probes ran under a 300s
 * timeout. At the ~16 tok/s a local 27B streams, 8192 reasoning tokens need ~512s, so the
 * timeout always fired first and the watchdog never ran. Probes died with empty
 * transcripts.
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';

import {
  BENCHMARK_FALLBACK_TOK_PER_SEC,
  MAX_BENCHMARK_THINKING_TOKENS,
  MIN_BENCHMARK_THINKING_TOKENS,
  getBenchmarkThroughput,
  recordBenchmarkThroughput,
  resetBenchmarkThroughput,
  resolveBenchmarkThinkingBudgetTokens,
} from '../../src/benchmark/thinking-budget-policy.ts';
import { ThinkingBudgetTracker } from '../../src/agents/thinking-budget.ts';
import { BenchmarkStreamContentRouter } from '../../src/benchmark/stream-text.ts';
import { needsThinkingCommitRetry } from '../../src/benchmark/llm-driver.ts';

const PROBE_TIMEOUT_MS = 300_000;

describe('resolveBenchmarkThinkingBudgetTokens', () => {
  test('budget is reachable within the timeout at the observed rate', () => {
    for (const tokPerSec of [4, 9.3, 16, 18.1, 40, 120]) {
      const budget = resolveBenchmarkThinkingBudgetTokens({
        timeoutMs: PROBE_TIMEOUT_MS,
        tokPerSec,
      });
      const secondsToTrip = budget / tokPerSec;
      assert.ok(
        secondsToTrip < PROBE_TIMEOUT_MS / 1000,
        `at ${tokPerSec} tok/s a ${budget}-token budget needs ${Math.round(secondsToTrip)}s, ` +
          `which the ${PROBE_TIMEOUT_MS / 1000}s timeout never reaches`,
      );
    }
  });

  test('sizes to the observed rate (16 tok/s over 300s -> ~40% of 4800 tokens)', () => {
    assert.equal(
      resolveBenchmarkThinkingBudgetTokens({ timeoutMs: PROBE_TIMEOUT_MS, tokPerSec: 16 }),
      1920,
    );
  });

  test('falls back to a conservative rate before the run has measured one', () => {
    assert.equal(
      resolveBenchmarkThinkingBudgetTokens({ timeoutMs: PROBE_TIMEOUT_MS }),
      resolveBenchmarkThinkingBudgetTokens({
        timeoutMs: PROBE_TIMEOUT_MS,
        tokPerSec: BENCHMARK_FALLBACK_TOK_PER_SEC,
      }),
    );
  });

  test('clamps a very slow target to the floor rather than to nothing', () => {
    assert.equal(
      resolveBenchmarkThinkingBudgetTokens({ timeoutMs: PROBE_TIMEOUT_MS, tokPerSec: 1 }),
      MIN_BENCHMARK_THINKING_TOKENS,
    );
  });

  test('keeps chat’s budget when no timeout bounds the call', () => {
    assert.equal(
      resolveBenchmarkThinkingBudgetTokens({ tokPerSec: 16 }),
      MAX_BENCHMARK_THINKING_TOKENS,
    );
  });
});

describe('benchmark throughput observer', () => {
  beforeEach(() => {
    resetBenchmarkThroughput();
  });

  test('reports nothing before a turn is recorded', () => {
    assert.equal(getBenchmarkThroughput('p', 'm'), null);
  });

  test('records and smooths successive rates', () => {
    recordBenchmarkThroughput('p', 'm', 20);
    assert.equal(getBenchmarkThroughput('p', 'm'), 20);
    recordBenchmarkThroughput('p', 'm', 10);
    assert.equal(getBenchmarkThroughput('p', 'm'), 15);
  });

  test('ignores absent or nonsense rates', () => {
    recordBenchmarkThroughput('p', 'm', null);
    recordBenchmarkThroughput('p', 'm', 0);
    recordBenchmarkThroughput('p', 'm', Number.NaN);
    assert.equal(getBenchmarkThroughput('p', 'm'), null);
  });

  test('keeps targets separate', () => {
    recordBenchmarkThroughput('p', 'fast', 40);
    recordBenchmarkThroughput('p', 'slow', 8);
    assert.equal(getBenchmarkThroughput('p', 'fast'), 40);
    assert.equal(getBenchmarkThroughput('p', 'slow'), 8);
  });
});

describe('needsThinkingCommitRetry', () => {
  const turn = (over: Partial<Parameters<typeof needsThinkingCommitRetry>[0]>) => ({
    thinkingBudgetExceeded: false,
    contentText: '',
    toolCalls: [],
    ...over,
  });

  test('retries when the watchdog cut a turn that produced nothing', () => {
    assert.equal(needsThinkingCommitRetry(turn({ thinkingBudgetExceeded: true })), true);
  });

  test('does not retry when the model already answered', () => {
    assert.equal(
      needsThinkingCommitRetry(
        turn({ thinkingBudgetExceeded: true, contentText: 'the ball costs $0.05' }),
      ),
      false,
    );
  });

  test('does not retry when the model already called a tool', () => {
    assert.equal(
      needsThinkingCommitRetry(
        turn({
          thinkingBudgetExceeded: true,
          toolCalls: [{ id: 't1', type: 'function', function: { name: 'get_datetime', arguments: '{}' } }],
        }),
      ),
      false,
    );
  });

  test('leaves an untripped turn alone', () => {
    assert.equal(needsThinkingCommitRetry(turn({})), false);
  });
});

describe('cumulative probe budget', () => {
  // Distinct text per delta: the tracker treats a delta that prefixes the accumulated text
  // as a provider resending cumulative reasoning, and replaces rather than appends.
  const reasoning = (tokens: number, tag: string): string =>
    `${tag} `.repeat(Math.round((tokens * 4) / (tag.length + 1)));

  /** Plain model id so content deltas route as prose, not as untagged inline thinking. */
  const MODEL = 'plain-test-model';

  test('prose does not hand the model a fresh allowance', () => {
    const tracker = new ThinkingBudgetTracker(1000);
    const router = new BenchmarkStreamContentRouter(MODEL, tracker, {
      cumulativeBudget: true,
    });

    router.ingestReasoningDelta(reasoning(600, 'alpha'));
    router.ingestContentDelta('a partial answer');
    router.ingestReasoningDelta(reasoning(600, 'bravo'));

    assert.equal(router.thinkingBudgetExceeded, true);
  });

  test('chat-style routing still resets per thinking block', () => {
    const tracker = new ThinkingBudgetTracker(1000);
    const router = new BenchmarkStreamContentRouter(MODEL, tracker);

    router.ingestReasoningDelta(reasoning(600, 'alpha'));
    router.ingestContentDelta('a partial answer');
    router.ingestReasoningDelta(reasoning(600, 'bravo'));

    assert.equal(router.thinkingBudgetExceeded, false);
  });
});
