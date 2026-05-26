/**
 * Modes suite: tool policy negative/positive probes per composer mode.
 */

import { loadModePromptBody, listModes } from '../../chat/modes/registry';
import { getEnabledToolDefinitionsForMode } from '../../tools/client';
import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { computeSuiteResultStats, toolNameMatch } from '../scoring.ts';
import { createBenchmarkExecuteToolFn } from '../execute-tool-sandbox.ts';
import { runToolLoop } from '../llm-driver.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
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
      announceTestStart(ctx, {
        testId: `mode-${modeId}-negative`,
        suite: 'modes',
        label: `${mode.label} denies ${neg.forbiddenTool}`,
      });
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
          maxToolRounds: 1,
          executeToolFn: createBenchmarkExecuteToolFn(modeId),
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
      announceTestStart(ctx, {
        testId: `mode-${modeId}-positive`,
        suite: 'modes',
        label: `${mode.label} emits ${pos.expectedTool}`,
      });
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
          maxToolRounds: 2,
          executeToolFn: createBenchmarkExecuteToolFn(modeId),
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

  const stats = computeSuiteResultStats(tests);

  return {
    id: 'modes',
    label: 'Modes',
    ...stats,
    tests,
  };
}
