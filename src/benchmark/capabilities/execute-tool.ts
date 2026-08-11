/**
 * Capability-matrix tool execution: stub side-effect tools unless explicitly allowed.
 */

import type { ExecuteToolContext } from '../../tools/client.ts';
import { stringifyAskQuestionResult } from '../../tools/ask-question-types.ts';
import type { ToolExecutionResult } from '../../types.ts';
import {
  executeBenchmarkTool,
  type BenchmarkExecuteToolOptions,
} from '../execute-tool-sandbox.ts';
import { CAPABILITY_PROBE_BY_ID } from './probes.ts';
import type { CapabilityProbeSpecBase } from './types.ts';

function collectEmitOnlyProbeToolIds(): string[] {
  const ids = new Set<string>();
  for (const spec of Object.values(CAPABILITY_PROBE_BY_ID)) {
    if (spec.kind === 'delegated') continue;
    const base = spec as CapabilityProbeSpecBase;
    if (!base.emitOnly) continue;
    for (const toolId of base.toolIds ?? []) {
      ids.add(toolId);
    }
  }
  return [...ids];
}

/** Tools that must not run during capability-matrix probes unless `allowSideEffects` is true. */
export const CAPABILITY_SIDE_EFFECT_TOOL_IDS = new Set<string>([
  ...collectEmitOnlyProbeToolIds(),
  'ask_question',
  'spawn_work_agent',
  'board_init',
  'board_update_task',
  'board_get_state',
  'request_browser_origin_access',
]);

function stubCapabilitySideEffectTool(name: string): ToolExecutionResult {
  if (name === 'ask_question') {
    return {
      content: stringifyAskQuestionResult({
        status: 'cancelled',
        answers: [],
      }),
    };
  }

  return {
    content: JSON.stringify({
      ok: true,
      benchmark: true,
      capabilityEmitOnly: true,
      stubbed: name,
    }),
  };
}

/** Whether capability matrix runs should stub this tool (default allowSideEffects false). */
export function isCapabilitySideEffectTool(name: string): boolean {
  return CAPABILITY_SIDE_EFFECT_TOOL_IDS.has(name);
}

/**
 * `executeToolFn` for capability-matrix `runToolLoop` — stubs side-effect tools when
 * `allowSideEffects` is false; otherwise delegates to `executeBenchmarkTool`.
 */
export function createCapabilityExecuteToolFn(
  allowSideEffects: boolean,
  opts: BenchmarkExecuteToolOptions = {},
): (
  name: string,
  args: Record<string, unknown>,
  context?: ExecuteToolContext,
) => ReturnType<typeof executeBenchmarkTool> {
  return (name, args, context) => {
    if (!allowSideEffects && CAPABILITY_SIDE_EFFECT_TOOL_IDS.has(name)) {
      return Promise.resolve(stubCapabilitySideEffectTool(name));
    }
    return executeBenchmarkTool(name, args, {
      workspaceRoot: opts.workspaceRoot ?? context?.workspaceRoot,
      modeId: context?.modeId ?? opts.modeId,
    });
  };
}
