/**
 * Capability suite: provider, streaming, tools schema, optional VLM/reasoning probes.
 */

import { getActiveProvider } from '../../providers/store';
import { fetchModelsForProvider } from '../../providers/fetch-models';
import { isVisionModel } from '../../providers/vision-model.ts';
import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { hasNonEmptyCompletion, streamCompletionTestDetails } from '../completion-valid.ts';
import { runCapMultimodalProbe } from './cap-multimodal-probe.ts';
import { computeSuiteResultStats } from '../scoring.ts';
import { runOneShot } from '../llm-driver.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
import type { LmModelRecord } from '../../types.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';
import { scoreMultimodalProbe } from './cap-multimodal.ts';

function result(
  id: string,
  label: string,
  passed: boolean,
  durationMs: number,
  details?: string,
  skipped = false,
  skipReason?: string,
): TestResult {
  return {
    testId: id,
    suite: 'capability',
    label,
    passed: skipped ? false : passed,
    skipped,
    skipReason,
    durationMs,
    score: skipped ? 0 : passed ? 1 : 0,
    details,
  };
}

export async function runCapabilitySuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const t0 = () => performance.now();

  assertNotAborted(ctx.signal);

  let catalogModels: LmModelRecord[] | undefined;

  // 1 — Provider reachable
  let t = t0();
  announceTestStart(ctx, {
    testId: 'cap-provider',
    suite: 'capability',
    label: 'Provider reachable',
  });
  try {
    const provider = await getActiveProvider(ctx.providerId);
    reportTest(ctx, tests,
      result('cap-provider', 'Provider reachable', Boolean(provider.baseUrl), performance.now() - t, provider.id),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    reportTest(ctx, tests,
      result(
        'cap-provider',
        'Provider reachable',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // 2 — Model resolves
  t = t0();
  announceTestStart(ctx, {
    testId: 'cap-model',
    suite: 'capability',
    label: 'Active model selected',
  });
  reportTest(ctx, tests,
    result(
      'cap-model',
      'Active model selected',
      Boolean(ctx.modelId),
      performance.now() - t,
      ctx.modelId || 'empty',
    ),
  );

  // 3 — Streaming
  assertNotAborted(ctx.signal);
  t = t0();
  announceTestStart(ctx, {
    testId: 'cap-stream',
    suite: 'capability',
    label: 'Streaming completion',
  });
  try {
    const stream = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [{ role: 'user', content: 'Say hello in one short word.' }],
    });
    const streamPassed = hasNonEmptyCompletion(stream.text);
    reportTest(ctx, tests,
      buildTestResult(
        result(
          'cap-stream',
          'Streaming completion',
          streamPassed,
          performance.now() - t,
          streamCompletionTestDetails(stream, streamPassed),
        ),
        stream,
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    reportTest(ctx, tests,
      buildTestResult(
        result(
          'cap-stream',
          'Streaming completion',
          false,
          performance.now() - t,
          err instanceof Error ? err.message : String(err),
        ),
        null,
        { error: err instanceof Error ? err.message : String(err) },
      ),
    );
  }

  // 4 — Usage chunk (skip if absent)
  assertNotAborted(ctx.signal);
  t = t0();
  announceTestStart(ctx, {
    testId: 'cap-usage',
    suite: 'capability',
    label: 'Usage metadata',
  });
  try {
    const stream = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [{ role: 'user', content: 'Count to three.' }],
    });
    const hasUsage =
      stream.timing.usage.completion_tokens != null ||
      stream.timing.usage.total_tokens != null;
    if (!hasUsage) {
      reportTest(ctx, tests,
        result(
          'cap-usage',
          'Usage metadata',
          false,
          performance.now() - t,
          'Provider omitted usage',
          true,
          'usage not reported',
        ),
      );
    } else {
      reportTest(ctx, tests,
        buildTestResult(
          result('cap-usage', 'Usage metadata', true, performance.now() - t),
          stream,
        ),
      );
    }
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    reportTest(ctx, tests,
      buildTestResult(
        result(
          'cap-usage',
          'Usage metadata',
          false,
          performance.now() - t,
          err instanceof Error ? err.message : String(err),
        ),
        null,
        { error: err instanceof Error ? err.message : String(err) },
      ),
    );
  }

  // 5 — Tool schema accepted
  assertNotAborted(ctx.signal);
  t = t0();
  announceTestStart(ctx, {
    testId: 'cap-tools-schema',
    suite: 'capability',
    label: 'Tool schema accepted',
  });
  try {
    const stream = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [{ role: 'user', content: 'What is 2+2? Reply with a number only.' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Math',
            parameters: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
          },
        },
      ],
    });
    reportTest(ctx, tests,
      buildTestResult(
        result(
          'cap-tools-schema',
          'Tool schema accepted',
          true,
          performance.now() - t,
          stream.finishReason ?? 'ok',
        ),
        stream,
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    reportTest(ctx, tests,
      buildTestResult(
        result(
          'cap-tools-schema',
          'Tool schema accepted',
          false,
          performance.now() - t,
          err instanceof Error ? err.message : String(err),
        ),
        null,
        { error: err instanceof Error ? err.message : String(err) },
      ),
    );
  }

  // 6 — Models list (fetch once; catalog reused for multimodal gate)
  assertNotAborted(ctx.signal);
  t = t0();
  announceTestStart(ctx, {
    testId: 'cap-models-list',
    suite: 'capability',
    label: 'Models list',
  });
  try {
    const provider = await getActiveProvider(ctx.providerId);
    catalogModels = await fetchModelsForProvider(provider, ctx.signal);
    reportTest(ctx, tests,
      result(
        'cap-models-list',
        'Models list',
        Array.isArray(catalogModels) && catalogModels.length > 0,
        performance.now() - t,
        `${catalogModels.length} models`,
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    reportTest(ctx, tests,
      result(
        'cap-models-list',
        'Models list',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // 7 — Multimodal (skip text-only; run image probe for vision models)
  assertNotAborted(ctx.signal);
  t = t0();
  announceTestStart(ctx, {
    testId: 'cap-multimodal',
    suite: 'capability',
    label: 'Multimodal request',
  });
  const catalogArg = catalogModels ?? [];
  if (!isVisionModel(ctx.modelId, catalogArg)) {
    reportTest(ctx, tests,
      result(
        'cap-multimodal',
        'Multimodal request',
        false,
        performance.now() - t,
        undefined,
        true,
        'not a vision model',
      ),
    );
  } else {
    try {
      const { oneShot: stream, scored } = await runCapMultimodalProbe(ctx);
      const multimodalPassed = hasNonEmptyCompletion(stream.text);
      reportTest(ctx, tests,
        buildTestResult(
          result(
            'cap-multimodal',
            'Multimodal request',
            scored.passed,
            performance.now() - t,
            multimodalPassed
              ? scored.details
              : streamCompletionTestDetails(stream, false),
          ),
          stream,
        ),
      );
    } catch (err) {
      rethrowIfAborted(err, ctx.signal);
      const scored = scoreMultimodalProbe(
        '',
        err instanceof Error ? err.message : String(err),
      );
      reportTest(ctx, tests,
        buildTestResult(
          result(
            'cap-multimodal',
            'Multimodal request',
            scored.passed,
            performance.now() - t,
            scored.details,
          ),
          null,
          { error: err instanceof Error ? err.message : String(err) },
        ),
      );
    }
  }

  const stats = computeSuiteResultStats(tests);

  return {
    id: 'capability',
    label: 'Capability',
    ...stats,
    tests,
  };
}
