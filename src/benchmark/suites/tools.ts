/**
 * Tools suite: one round-trip per built-in tool (serial).
 * File tools run first against ~/.minnow/benchmark-workspace/.minnow-bench/.
 */

import { BUILT_IN_TOOLS, type ToolDefinition } from '../../tools/definitions';
import { assertNotAborted, raceWithAbort, rethrowIfAborted } from '../abort.ts';
import {
  cleanupBenchmarkFixtureDir,
  ensureBenchmarkWorkspaceReady,
  type BenchmarkWorkspaceContext,
} from '../benchmark-workspace.ts';
import { computeSuiteResultStats, toolNameMatch } from '../scoring.ts';
import {
  createBenchmarkExecuteToolFn,
  executeBenchmarkTool,
  type BenchmarkExecuteToolOptions,
} from '../execute-tool-sandbox.ts';
import { runToolLoop } from '../llm-driver.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';
import { FILE_TOOL_PROBE_ORDER, getFileToolFixture, getOrderedFileTools } from './file-tool-fixtures.ts';
import { EMIT_ONLY_TOOL_IDS, getToolFixture, type ToolFixture } from './tools-fixtures.ts';

type ExecuteToolFn = ReturnType<typeof createBenchmarkExecuteToolFn>;

async function runSingleToolProbe(
  ctx: BenchmarkRunContext,
  tool: ToolDefinition,
  fixture: ToolFixture,
  executeToolFn: ExecuteToolFn,
  benchOpts: BenchmarkExecuteToolOptions | undefined,
  tests: TestResult[],
): Promise<void> {
  assertNotAborted(ctx.signal);
  const t0 = performance.now();
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
    return;
  }

  try {
    const out = await runToolLoop({
      providerId: ctx.providerId,
      modelId: ctx.modelId,
      signal: ctx.signal,
      messages: [{ role: 'user', content: fixture.prompt }],
      tools: [tool.definition],
      maxToolRounds: 2,
      executeToolFn,
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
          executeBenchmarkTool(tool.id, args, benchOpts ?? {}),
        );
        if (fixture.verifyExec) {
          execOk = fixture.verifyExec(exec.content);
          details = execOk ? 'content verified' : 'content verification failed';
        } else {
          execOk = !exec.content.startsWith('Error:');
          details = execOk ? 'executed' : exec.content.slice(0, 120);
        }
      } catch (err) {
        execOk = false;
        details = err instanceof Error ? err.message : String(err);
      }
    } else if (fixture.emitOnly || EMIT_ONLY_TOOL_IDS.has(tool.id)) {
      details = 'emit-only (execution skipped)';
      execOk = nameOk;
    }

    const passed = nameOk && argsOk && execOk;
    reportTest(
      ctx,
      tests,
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
    reportTest(
      ctx,
      tests,
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

export async function runToolsSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  let benchCtx: BenchmarkWorkspaceContext | null = null;
  let benchOpts: BenchmarkExecuteToolOptions | undefined;
  const fileToolIds = new Set(FILE_TOOL_PROBE_ORDER);

  try {
    if (ctx.localServer) {
      benchCtx = await ensureBenchmarkWorkspaceReady();
      benchOpts = { workspaceRoot: benchCtx.workspaceRoot };
    }

    const fileExecuteFn = createBenchmarkExecuteToolFn(benchOpts ?? {});
    for (const tool of getOrderedFileTools()) {
      await runSingleToolProbe(
        ctx,
        tool,
        getFileToolFixture(tool),
        fileExecuteFn,
        benchOpts,
        tests,
      );
    }

    const nonFileExecuteFn = createBenchmarkExecuteToolFn();
    for (const tool of BUILT_IN_TOOLS) {
      if (fileToolIds.has(tool.id)) continue;
      await runSingleToolProbe(
        ctx,
        tool,
        getToolFixture(tool),
        nonFileExecuteFn,
        undefined,
        tests,
      );
    }
  } finally {
    if (benchCtx) {
      await cleanupBenchmarkFixtureDir(benchCtx.workspaceRoot);
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
