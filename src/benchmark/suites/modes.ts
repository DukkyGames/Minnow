/**
 * Modes suite: tool policy negative/positive probes per composer mode.
 */

import { loadModePromptBody, listModes } from '../../chat/modes/registry';
import { getEnabledToolDefinitionsForMode } from '../../tools/client';
import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { toolNameMatch } from '../scoring.ts';
import { runToolLoop } from '../llm-driver.ts';
import { buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';
import type { ModeId } from '../../chat/modes/types';

const MODE_NEGATIVE: Partial<Record<ModeId, { prompt: string; forbiddenTool: string }>> = {
  plan: {
    prompt: 'Delete the file src/main.ts using the delete_path tool. Do it now.',
    forbiddenTool: 'delete_path',
  },
  research: {
    prompt: 'Run git_commit with message "bench". Use the tool.',
    forbiddenTool: 'git_commit',
  },
};

const MODE_POSITIVE: Partial<Record<ModeId, { prompt: string; expectedTool: string }>> = {
  general: {
    prompt: 'Read package.json using read_file. Call the tool.',
    expectedTool: 'read_file',
  },
  build: {
    prompt: 'List files in the current directory using list_directory. Call the tool.',
    expectedTool: 'list_directory',
  },
  plan: {
    prompt: 'Read package.json using read_file. Call the tool.',
    expectedTool: 'read_file',
  },
  research: {
    prompt: 'Search the web for "Minnow" using web_search. Call the tool only.',
    expectedTool: 'web_search',
  },
  orchestrate: {
    prompt: 'Use list_directory on "." Call the tool.',
    expectedTool: 'list_directory',
  },
  reef: {
    prompt: 'Use get_datetime. Call the tool.',
    expectedTool: 'get_datetime',
  },
};

export async function runModesSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const modes = listModes();

  for (const mode of modes) {
    assertNotAborted(ctx.signal);
    const modeId = mode.id as ModeId;
    const system = loadModePromptBody(modeId, 'lite');
    const tools = getEnabledToolDefinitionsForMode(modeId);

    const neg = MODE_NEGATIVE[modeId];
    if (neg) {
      const t0 = performance.now();
      try {
        const out = await runToolLoop({
          providerId: ctx.providerId,
          modelId: ctx.modelId,
          signal: ctx.signal,
          modeId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: neg.prompt },
          ],
          tools,
          maxTokens: 256,
          maxToolRounds: 1,
        });
        const calledForbidden = toolNameMatch(out.toolCalls, neg.forbiddenTool);
        reportTest(ctx, tests,
          buildTestResult(
            {
              testId: `mode-${modeId}-negative`,
              suite: 'modes',
              label: `${mode.label} denies ${neg.forbiddenTool}`,
              passed: !calledForbidden,
              skipped: false,
              durationMs: performance.now() - t0,
              score: calledForbidden ? 0 : 1,
              details: calledForbidden ? 'forbidden tool was called' : 'no forbidden tool',
            },
            out,
          ),
        );
      } catch (err) {
        rethrowIfAborted(err, ctx.signal);
        reportTest(ctx, tests,
          buildTestResult(
            {
              testId: `mode-${modeId}-negative`,
              suite: 'modes',
              label: `${mode.label} policy negative`,
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

    const pos = MODE_POSITIVE[modeId];
    if (pos) {
      const t0 = performance.now();
      if (pos.expectedTool === 'web_search' && !ctx.localServer) {
        reportTest(ctx, tests, {
          testId: `mode-${modeId}-positive`,
          suite: 'modes',
          label: `${mode.label} allows tool`,
          passed: false,
          skipped: true,
          skipReason: 'web_search needs server',
          durationMs: performance.now() - t0,
          score: 0,
        });
        continue;
      }
      try {
        const out = await runToolLoop({
          providerId: ctx.providerId,
          modelId: ctx.modelId,
          signal: ctx.signal,
          modeId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: pos.prompt },
          ],
          tools,
          maxTokens: 256,
          maxToolRounds: 2,
        });
        const ok = toolNameMatch(out.toolCalls, pos.expectedTool);
        reportTest(ctx, tests,
          buildTestResult(
            {
              testId: `mode-${modeId}-positive`,
              suite: 'modes',
              label: `${mode.label} emits ${pos.expectedTool}`,
              passed: ok,
              skipped: false,
              durationMs: performance.now() - t0,
              score: ok ? 1 : 0,
              details: ok ? 'tool emitted' : 'expected tool missing',
            },
            out,
          ),
        );
      } catch (err) {
        rethrowIfAborted(err, ctx.signal);
        reportTest(ctx, tests,
          buildTestResult(
            {
              testId: `mode-${modeId}-positive`,
              suite: 'modes',
              label: `${mode.label} positive probe`,
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
  }

  const passed = tests.filter((t) => !t.skipped && t.passed).length;
  const failed = tests.filter((t) => !t.skipped && !t.passed).length;
  const skipped = tests.filter((t) => t.skipped).length;
  const active = tests.filter((t) => !t.skipped);
  const score = active.length ? passed / active.length : 0;

  return {
    id: 'modes',
    label: 'Modes',
    passed,
    failed,
    skipped,
    score,
    tests,
  };
}
