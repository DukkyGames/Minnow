/**
 * Build benchmark TestResult rows with optional persisted transcripts.
 */

import type { ApiMessage } from '../types.ts';
import type { OneShotResult } from './llm-driver.ts';
import type { BenchmarkRunContext, TestResult } from './types.ts';

/** Max persisted length per tool message content. */
export const TRANSCRIPT_TOOL_CONTENT_CAP = 12_288;

/** Approximate max serialized run size before stripping transcripts (POST cap is 2 MB). */
export const BENCHMARK_RUN_SIZE_SOFT_CAP = 1_800_000;

type TestResultBase = Omit<TestResult, 'transcript' | 'transcriptMeta'>;

export interface BuildTestResultExtra {
  error?: string;
  judgeRaw?: string;
}

/** Truncate system prompts and large tool payloads for persistence. */
export function truncateTranscriptForPersistence(messages: ApiMessage[]): ApiMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'system' && typeof msg.content === 'string') {
      const full = msg.content;
      if (full.length <= 800) return msg;
      return {
        ...msg,
        content: `${full.slice(0, 800)}… (${full.length} characters total)`,
      };
    }
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      const full = msg.content;
      if (full.length <= TRANSCRIPT_TOOL_CONTENT_CAP) return msg;
      return {
        ...msg,
        content: `${full.slice(0, TRANSCRIPT_TOOL_CONTENT_CAP)}… truncated`,
      };
    }
    return msg;
  });
}

/** Notify live progress listeners before a probe begins. */
export function announceTestStart(
  ctx: BenchmarkRunContext,
  meta: Pick<TestResult, 'testId' | 'suite' | 'label'>,
): void {
  ctx.onTestStart?.(meta);
}

/** Append a finished probe to the suite list and notify live progress listeners. */
export function reportTest(
  ctx: BenchmarkRunContext,
  tests: TestResult[],
  result: TestResult,
): void {
  tests.push(result);
  ctx.onTestDone?.(result);
}

/** Attach transcript fields from an LLM driver result when present. */
export function buildTestResult(
  base: TestResultBase,
  out?: OneShotResult | null,
  extra?: BuildTestResultExtra,
): TestResult {
  const transcriptMeta: NonNullable<TestResult['transcriptMeta']> = {};
  if (out?.finishReason) transcriptMeta.finishReason = out.finishReason;
  if (extra?.error) transcriptMeta.error = extra.error;
  if (extra?.judgeRaw) transcriptMeta.judgeRaw = extra.judgeRaw;

  const hasMeta = Object.keys(transcriptMeta).length > 0;
  if (!out?.messages?.length) {
    return hasMeta ? { ...base, transcriptMeta } : base;
  }

  return {
    ...base,
    transcript: truncateTranscriptForPersistence(out.messages),
    ...(hasMeta ? { transcriptMeta } : {}),
  };
}

function stripTranscriptsFromRun(run: import('./types.ts').BenchmarkRun): void {
  for (const suite of run.suites) {
    for (const test of suite.tests) {
      delete test.transcript;
      test.transcriptMeta = {
        ...test.transcriptMeta,
        error: 'Transcript omitted (size cap)',
      };
    }
  }
}

/** Shrink run JSON when approaching the benchmarks POST body limit. */
export function prepareBenchmarkRunForPersistence(
  run: import('./types.ts').BenchmarkRun,
): import('./types.ts').BenchmarkRun {
  const clone = structuredClone(run) as import('./types.ts').BenchmarkRun;
  let serialized = JSON.stringify(clone);
  if (serialized.length <= BENCHMARK_RUN_SIZE_SOFT_CAP) return clone;

  stripTranscriptsFromRun(clone);
  serialized = JSON.stringify(clone);
  if (serialized.length <= BENCHMARK_RUN_SIZE_SOFT_CAP) return clone;

  return clone;
}
