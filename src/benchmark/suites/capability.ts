/**
 * Capability suite: provider, streaming, tools schema, optional VLM/reasoning probes.
 */

import { getActiveProvider } from '../../providers/store';
import { fetchModelsForProvider } from '../../providers/fetch-models';
import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { runOneShot } from '../llm-driver.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';

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

/** Heuristic VLM detection when model cache type is unavailable. */
function modelLooksMultimodal(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /vlm|vision|llava|bakllava|moondream|multimodal/.test(id);
}

export async function runCapabilitySuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const t0 = () => performance.now();

  assertNotAborted(ctx.signal);

  // 1 — Provider reachable
  let t = t0();
  try {
    const provider = await getActiveProvider(ctx.providerId);
    tests.push(
      result('cap-provider', 'Provider reachable', Boolean(provider.baseUrl), performance.now() - t, provider.id),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    tests.push(
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
  tests.push(
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
  try {
    const stream = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [
        { role: 'system', content: 'Reply with one short word only.' },
        { role: 'user', content: 'Say hello.' },
      ],
      maxTokens: 32,
    });
    tests.push(
      result(
        'cap-stream',
        'Streaming completion',
        stream.text.length > 0,
        performance.now() - t,
        stream.text.slice(0, 80),
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    tests.push(
      result(
        'cap-stream',
        'Streaming completion',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // 4 — Usage chunk (skip if absent)
  assertNotAborted(ctx.signal);
  t = t0();
  try {
    const stream = await runOneShot({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [{ role: 'user', content: 'Count to three.' }],
      maxTokens: 64,
    });
    const hasUsage =
      stream.timing.usage.completion_tokens != null ||
      stream.timing.usage.total_tokens != null;
    if (!hasUsage) {
      tests.push(
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
      tests.push(result('cap-usage', 'Usage metadata', true, performance.now() - t));
    }
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    tests.push(
      result(
        'cap-usage',
        'Usage metadata',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // 5 — Tool schema accepted
  assertNotAborted(ctx.signal);
  t = t0();
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
      maxTokens: 128,
    });
    tests.push(
      result(
        'cap-tools-schema',
        'Tool schema accepted',
        true,
        performance.now() - t,
        stream.finishReason ?? 'ok',
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    tests.push(
      result(
        'cap-tools-schema',
        'Tool schema accepted',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // 6 — Models list
  assertNotAborted(ctx.signal);
  t = t0();
  try {
    const provider = await getActiveProvider(ctx.providerId);
    const models = await fetchModelsForProvider(provider, ctx.signal);
    tests.push(
      result(
        'cap-models-list',
        'Models list',
        Array.isArray(models) && models.length > 0,
        performance.now() - t,
        `${models.length} models`,
      ),
    );
  } catch (err) {
    rethrowIfAborted(err, ctx.signal);
    tests.push(
      result(
        'cap-models-list',
        'Models list',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // 7 — Multimodal (skip on text-only)
  t = t0();
  if (!modelLooksMultimodal(ctx.modelId)) {
    tests.push(
      result(
        'cap-multimodal',
        'Multimodal request',
        false,
        performance.now() - t,
        undefined,
        true,
        'not a VLM model',
      ),
    );
  } else {
    tests.push(
      result(
        'cap-multimodal',
        'Multimodal request',
        true,
        performance.now() - t,
        'skipped deep image probe in v1',
        true,
        'VLM probe deferred',
      ),
    );
  }

  const passed = tests.filter((x) => !x.skipped && x.passed).length;
  const failed = tests.filter((x) => !x.skipped && !x.passed).length;
  const skipped = tests.filter((x) => x.skipped).length;
  const active = tests.filter((x) => !x.skipped);
  const score = active.length ? active.filter((x) => x.passed).length / active.length : 0;

  return {
    id: 'capability',
    label: 'Capability',
    passed,
    failed,
    skipped,
    score,
    tests,
  };
}
