/**
 * Speed suite: median TTFT and tok/s from fixed prompts.
 */

import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { hasNonEmptyCompletion, speedCompletionDetails } from '../completion-valid.ts';
import { runOneShot } from '../llm-driver.ts';
import { buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, LlmTurnTiming, SuiteResult, TestResult } from '../types.ts';

/** Fields from runOneShot used to score speed tests (unit-tested without live LLM). */
export interface SpeedCompletionOutcome {
  text: string;
  timing: Pick<LlmTurnTiming, 'ttftMs' | 'tokPerSec'>;
}

/** Pass/fail, details, and optional headline timing samples for one speed completion. */
export function scoreSpeedCompletion(text: string, timing: SpeedCompletionOutcome['timing']): {
  passed: boolean;
  score: number;
  details: string;
  ttftSample: number | null;
  tpsSample: number | null;
} {
  const ok = hasNonEmptyCompletion(text);
  return {
    passed: ok,
    score: ok ? 1 : 0,
    details: speedCompletionDetails(text),
    ttftSample: ok && timing.ttftMs != null ? timing.ttftMs : null,
    tpsSample: ok && timing.tokPerSec != null ? timing.tokPerSec : null,
  };
}

const SHORT_PROMPT =
  'Write exactly three short sentences about local LLM inference. No preamble.';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function runSpeedSuite(ctx: BenchmarkRunContext): Promise<{
  suite: SuiteResult;
  headlineTtftMs: number;
  headlineTokPerSec: number;
}> {
  const tests: TestResult[] = [];
  const ttftSamples: number[] = [];
  const tpsSamples: number[] = [];

  for (let i = 0; i < 3; i++) {
    assertNotAborted(ctx.signal);
    const t0 = performance.now();
    try {
      const out = await runOneShot({
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        signal: ctx.signal,
        messages: [{ role: 'user', content: SHORT_PROMPT }],
        maxTokens: 200,
      });
      const durationMs = performance.now() - t0;
      const scored = scoreSpeedCompletion(out.text, out.timing);
      if (scored.ttftSample != null) ttftSamples.push(scored.ttftSample);
      if (scored.tpsSample != null) tpsSamples.push(scored.tpsSample);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `speed-short-${i + 1}`,
            suite: 'speed',
            label: `Short run ${i + 1}`,
            passed: scored.passed,
            skipped: false,
            durationMs,
            ttftMs: out.timing.ttftMs ?? undefined,
            tokPerSec: out.timing.tokPerSec ?? undefined,
            score: scored.score,
            details: scored.details,
          },
          out,
        ),
      );
    } catch (err) {
      rethrowIfAborted(err, ctx.signal);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `speed-short-${i + 1}`,
            suite: 'speed',
            label: `Short run ${i + 1}`,
            passed: false,
            skipped: false,
            durationMs: performance.now() - t0,
            score: 0,
            details: err instanceof Error ? err.message : String(err),
          },
          null,
          { error: err instanceof Error ? err.message : String(err) },
        ),
      );
    }
  }

  assertNotAborted(ctx.signal);
  const tLong = performance.now();
  try {
    const out = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [
        {
          role: 'user',
          content:
            'Explain how transformer attention works in about 400 words. Use clear paragraphs.',
        },
      ],
      maxTokens: 600,
    });
    const durationMs = performance.now() - tLong;
    const scored = scoreSpeedCompletion(out.text, out.timing);
    if (scored.tpsSample != null) tpsSamples.push(scored.tpsSample);
    reportTest(ctx, tests,
      buildTestResult(
        {
          testId: 'speed-long-1',
          suite: 'speed',
          label: 'Sustained throughput',
          passed: scored.passed,
          skipped: false,
          durationMs,
          tokPerSec: out.timing.tokPerSec ?? undefined,
          score: scored.score,
          details: scored.details,
        },
        out,
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    reportTest(ctx, tests,
      buildTestResult(
        {
          testId: 'speed-long-1',
          suite: 'speed',
          label: 'Sustained throughput',
          passed: false,
          skipped: false,
          durationMs: performance.now() - tLong,
          score: 0,
          details: err instanceof Error ? err.message : String(err),
        },
        null,
        { error: err instanceof Error ? err.message : String(err) },
      ),
    );
  }

  return {
    suite: {
      id: 'speed',
      label: 'Speed',
      passed: tests.filter((t) => t.passed).length,
      failed: tests.filter((t) => !t.passed).length,
      skipped: 0,
      score: 1,
      tests,
    },
    headlineTtftMs: median(ttftSamples),
    headlineTokPerSec: median(tpsSamples),
  };
}
