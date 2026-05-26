/**
 * Tools suite: one round-trip per built-in tool (serial).
 */

import { BUILT_IN_TOOLS } from '../../tools/definitions';
import { executeTool } from '../../tools/client';
import { assertNotAborted, raceWithAbort, rethrowIfAborted } from '../abort.ts';
import { computeSuiteResultStats, toolNameMatch } from '../scoring.ts';
import { createBenchmarkExecuteToolFn } from '../execute-tool-sandbox.ts';
import { runToolLoop } from '../llm-driver.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';
import { EMIT_ONLY_TOOL_IDS, getToolFixture } from './tools-fixtures.ts';

export async function runToolsSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];

  for (const tool of BUILT_IN_TOOLS) {
    assertNotAborted(ctx.signal);
    const t0 = performance.now();
    const fixture = getToolFixture(tool);
    announceTestStart(ctx, {
      testId: `tool-${tool.id}`,
      suite: 'tools',
      label: tool.label,
    });

    if (tool.serverRequired && !ctx.localServer) {
      reportTest(ctx, tests, {
        testId: `tool-${tool.id}`,
        suite: 'tools',
        label: tool.label,
        passed: false,
        skipped: true,
        skipReason: 'needs npm start',
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
        messages: [{ role: 'user', content: fixture.prompt }],
        tools: [tool.definition],
        maxToolRounds: 2,
        executeToolFn: createBenchmarkExecuteToolFn(),
      });

      const nameOk = toolNameMatch(out.toolCalls, tool.id);
      const firstCall = out.toolCalls[0];
      let argsOk = true;
      if (firstCall && fixture.expectArgs) {
        try {
          const args = JSON.parse(firstCall.function.arguments || '{}') as Record<string, unknown>;
          argsOk = fixture.expectArgs(args);
        } catch {
          argsOk = false;
        }
      }

      let execOk = true;
      let details = '';
      if (nameOk && firstCall && !fixture.emitOnly && !EMIT_ONLY_TOOL_IDS.has(tool.id)) {
        try {
          const args = JSON.parse(firstCall.function.arguments || '{}') as Record<string, unknown>;
          const exec = await raceWithAbort(
            ctx.signal,
            executeTool(tool.id, args),
          );
          execOk = !exec.content.startsWith('Error:');
          details = execOk ? 'executed' : exec.content.slice(0, 120);
        } catch (err) {
          execOk = false;
          details = err instanceof Error ? err.message : String(err);
        }
      } else if (fixture.emitOnly || EMIT_ONLY_TOOL_IDS.has(tool.id)) {
        details = 'emit-only (execution skipped)';
        execOk = nameOk;
      }

      const passed = nameOk && argsOk && execOk;
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `tool-${tool.id}`,
            suite: 'tools',
            label: tool.label,
            passed,
            skipped: false,
            durationMs: performance.now() - t0,
            score: passed ? 1 : 0,
            details: details || (nameOk ? 'tool call ok' : 'no matching tool call'),
          },
          out,
        ),
      );
    } catch (err) {
      rethrowIfAborted(err, ctx.signal);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `tool-${tool.id}`,
            suite: 'tools',
            label: tool.label,
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

  const stats = computeSuiteResultStats(tests);

  return {
    id: 'tools',
    label: 'Tools',
    ...stats,
    tests,
  };
}
