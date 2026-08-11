/**
 * Execute a single capability-matrix auto probe via the headless LLM driver.
 */

import { getToolById, type OpenAIFunctionDefinition } from '../../tools/definitions.ts';
import type { ToolCall } from '../../types.ts';
import { runDelegatedCapabilityProbe } from './delegated-probes.ts';
import { createCapabilityExecuteToolFn } from './execute-tool.ts';
import { runOneShot, runToolLoop, type OneShotResult } from '../llm-driver.ts';
import type { BenchmarkRunContext } from '../types.ts';
import { getCapabilityFixtureProbePrompt } from './fixtures-workspace.ts';
import type {
  CapabilityDefinition,
  CapabilityProbeRunOutput,
  CapabilityProbeSpec,
  CapabilityProbeSpecBase,
  CapabilityRoundTelemetry,
  CapabilityScoredVerdict,
  CapabilityVerdict,
  DelegatedCapabilityProbeSpec,
} from './types.ts';

export interface RunCapabilityProbeOptions {
  workspaceRoot?: string;
}

export interface RunCapabilityProbeResult {
  skipped: boolean;
  skipReason?: string;
  verdict: CapabilityVerdict;
  reason: string;
  oneShot?: OneShotResult;
}

function isDelegatedSpec(spec: CapabilityProbeSpec): spec is DelegatedCapabilityProbeSpec {
  return spec.kind === 'delegated';
}

function isRunnableSpec(spec: CapabilityProbeSpec): spec is CapabilityProbeSpecBase {
  return spec.kind !== 'delegated';
}

function buildUserMessage(cap: CapabilityDefinition): string {
  const fixturePrompt = getCapabilityFixtureProbePrompt(cap.id);
  if (fixturePrompt) return fixturePrompt;
  const prompt = cap.prompt.trim();
  if (prompt.length >= 24 && !/^for a /i.test(prompt)) return prompt;
  return cap.howToTest.trim() || prompt;
}

function mapToolCalls(toolCalls: ToolCall[]): CapabilityProbeRunOutput['toolCalls'] {
  return toolCalls.map((tc) => ({
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
}

function probeOutputFromOneShot(
  out: OneShotResult,
  rounds: CapabilityRoundTelemetry[],
): CapabilityProbeRunOutput {
  return {
    text: out.text,
    streamChunkCount: out.timing.streamChunkCount,
    toolCalls: mapToolCalls(out.toolCalls),
    rounds,
  };
}

function resolveProbeToolIds(spec: CapabilityProbeSpecBase): string[] {
  if (spec.toolIds?.length) return spec.toolIds;
  if (spec.kind === 'derived' || spec.kind === 'tool-call' || spec.kind === 'tool-chain') {
    return ['get_datetime'];
  }
  return [];
}

function resolveOpenAiTools(toolIds: string[]): OpenAIFunctionDefinition[] {
  const defs: OpenAIFunctionDefinition[] = [];
  for (const id of toolIds) {
    const tool = getToolById(id);
    if (tool) defs.push(tool.definition);
  }
  return defs;
}

function usesToolLoop(spec: CapabilityProbeSpecBase): boolean {
  return (
    spec.kind === 'tool-call' ||
    spec.kind === 'tool-chain' ||
    spec.kind === 'derived' ||
    (spec.kind === 'stream' && Boolean(spec.toolIds?.length))
  );
}

function scoreFromVerdict(verdict: CapabilityScoredVerdict): number {
  if (verdict === 'pass') return 1;
  if (verdict === 'partial') return 0.5;
  return 0;
}

/** Map probe verdict to benchmark row fields. */
export function capabilityTestFieldsFromVerdict(
  verdict: CapabilityScoredVerdict,
  reason: string,
): { passed: boolean; score: number; details: string } {
  return {
    passed: verdict === 'pass',
    score: scoreFromVerdict(verdict),
    details: reason,
  };
}

/**
 * Run one catalog auto probe (caller must skip manual / unmet requirements).
 */
export async function runCapabilityProbe(
  ctx: BenchmarkRunContext,
  cap: CapabilityDefinition,
  options: RunCapabilityProbeOptions = {},
): Promise<RunCapabilityProbeResult> {
  const probe = cap.probe;
  if (!probe) {
    return {
      skipped: true,
      skipReason: 'missing probe spec',
      verdict: 'n-a',
      reason: 'missing probe spec',
    };
  }
  if (isDelegatedSpec(probe)) {
    return runDelegatedCapabilityProbe(ctx, probe);
  }
  if (!isRunnableSpec(probe)) {
    return {
      skipped: true,
      skipReason: 'unsupported probe kind',
      verdict: 'n-a',
      reason: 'unsupported probe kind',
    };
  }

  const userMessage = buildUserMessage(cap);
  const rounds: CapabilityRoundTelemetry[] = [];
  const allowSideEffects = ctx.capabilityMatrix?.allowSideEffects === true;
  const executeToolFn = createCapabilityExecuteToolFn(allowSideEffects, {
    workspaceRoot: options.workspaceRoot,
  });

  try {
    let oneShot: OneShotResult;
    if (usesToolLoop(probe)) {
      const toolIds = resolveProbeToolIds(probe);
      oneShot = await runToolLoop({
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        signal: ctx.signal,
        messages: [{ role: 'user', content: userMessage }],
        tools: resolveOpenAiTools(toolIds),
        maxToolRounds: probe.maxToolRounds ?? 3,
        executeToolFn,
        onRound: (round) => rounds.push(round),
      });
    } else {
      const toolIds = probe.toolIds ?? [];
      oneShot = await runOneShot({
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        signal: ctx.signal,
        messages: [{ role: 'user', content: userMessage }],
        ...(toolIds.length ? { tools: resolveOpenAiTools(toolIds) } : {}),
      });
    }

    const out = probeOutputFromOneShot(oneShot, rounds);
    const judged = probe.verdict(out);
    return {
      skipped: false,
      verdict: judged.verdict,
      reason: judged.reason,
      oneShot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skipped: false,
      verdict: 'fail',
      reason: message,
    };
  }
}
