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
import { capabilityStubPayload } from './stub-fixtures.ts';
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
  'request_browser_origin_access',
]);

function stubCapabilitySideEffectTool(
  name: string,
  args?: Record<string, unknown>,
): ToolExecutionResult {
  if (name === 'ask_question') {
    return {
      content: stringifyAskQuestionResult({
        status: 'cancelled',
        answers: [],
      }),
    };
  }

  const payload = capabilityStubPayload(name, args);
  if (payload !== null) {
    return {
      content: JSON.stringify({
        ok: true,
        benchmark: true,
        capabilityEmitOnly: true,
        stubbed: name,
        ...(payload as Record<string, unknown>),
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

export interface CapabilityExecuteToolOptions extends BenchmarkExecuteToolOptions {
  /**
   * Extra tool ids this probe run must never execute — the probe's own emit-only tools
   * and its trap tools. Kept per-run because a tool that is emit-only for one row
   * (a Plan-mode `save_file` trap) is executed for real by another (`files-save-append`).
   */
  stubToolIds?: readonly string[];
}

/**
 * `executeToolFn` for capability-matrix `runToolLoop` — stubs side-effect tools when
 * `allowSideEffects` is false; otherwise delegates to `executeBenchmarkTool`.
 */
export function createCapabilityExecuteToolFn(
  allowSideEffects: boolean,
  opts: CapabilityExecuteToolOptions = {},
): (
  name: string,
  args: Record<string, unknown>,
  context?: ExecuteToolContext,
) => ReturnType<typeof executeBenchmarkTool> {
  const perRunStubs = new Set(opts.stubToolIds ?? []);
  return (name, args, context) => {
    if (perRunStubs.has(name)) {
      return Promise.resolve(stubCapabilitySideEffectTool(name, args));
    }
    if (!allowSideEffects && CAPABILITY_SIDE_EFFECT_TOOL_IDS.has(name)) {
      return Promise.resolve(stubCapabilitySideEffectTool(name, args));
    }
    return executeBenchmarkTool(name, args, {
      workspaceRoot: opts.workspaceRoot ?? context?.workspaceRoot,
      modeId: context?.modeId ?? opts.modeId,
    });
  };
}
