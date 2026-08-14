/**
 * Run capability-matrix rows that delegate to other benchmark suites (phase 2f).
 */

import { fetchSkillById, refreshSkillCatalog } from '../../skills/client.ts';
import { createBenchmarkExecuteToolFn } from '../execute-tool-sandbox.ts';
import { runOneShot, runToolLoop, type OneShotResult } from '../llm-driver.ts';
import { runCapMultimodalProbe } from '../suites/cap-multimodal-probe.ts';
import {
  evaluateSkillProbe,
  getSkillProbe,
  resolveSkillProbeSkip,
  resolveSkillProbeTools,
} from '../suites/skill-probes.ts';
import type { BenchmarkRunContext } from '../types.ts';
import type { DelegatedCapabilityProbeSpec } from './types.ts';
import type { RunCapabilityProbeResult } from './run-probe.ts';

function verdictFromPass(passed: boolean, reason: string): RunCapabilityProbeResult {
  return {
    skipped: false,
    verdict: passed ? 'pass' : 'fail',
    reason,
  };
}

/** Map `skills` suite test id `skill-<skillId>` to built-in skill id. */
function skillIdFromDelegatedTestId(testId: string): string | null {
  if (!testId.startsWith('skill-')) return null;
  return testId.slice('skill-'.length) || null;
}

async function runDelegatedSkillProbe(
  ctx: BenchmarkRunContext,
  skillId: string,
): Promise<RunCapabilityProbeResult> {
  await refreshSkillCatalog();
  const probe = getSkillProbe(skillId);
  const skipReason = resolveSkillProbeSkip(probe, ctx);
  if (skipReason) {
    return {
      skipped: true,
      skipReason,
      verdict: 'n-a',
      reason: skipReason,
    };
  }

  const detail = await fetchSkillById(skillId);
  const system = detail?.body?.trim() ?? '';
  if (!system) {
    const reason = 'skill body not loaded';
    return {
      skipped: true,
      skipReason: reason,
      verdict: 'n-a',
      reason,
    };
  }

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: probe.prompt },
  ];
  const tools = resolveSkillProbeTools(probe);
  let oneShot: OneShotResult;

  try {
    oneShot =
      tools.length > 0
        ? await runToolLoop({
            providerId: ctx.providerId,
            modelId: ctx.modelId,
            signal: ctx.signal,
            messages,
            tools,
            maxToolRounds: 4,
            executeToolFn: createBenchmarkExecuteToolFn(),
          })
        : await runOneShot({
            providerId: ctx.providerId,
            modelId: ctx.modelId,
            signal: ctx.signal,
            messages,
          });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skipped: false,
      verdict: 'fail',
      reason: message,
    };
  }

  const evaluation = evaluateSkillProbe(probe, oneShot);
  const base = verdictFromPass(evaluation.passed, evaluation.details);
  return { ...base, oneShot };
}

async function runDelegatedCapMultimodal(ctx: BenchmarkRunContext): Promise<RunCapabilityProbeResult> {
  const { oneShot, scored } = await runCapMultimodalProbe(ctx);
  const base = verdictFromPass(scored.passed, scored.details);
  return { ...base, oneShot };
}

/**
 * Execute a delegated probe spec (caller must satisfy requirements and wave gating).
 */
export async function runDelegatedCapabilityProbe(
  ctx: BenchmarkRunContext,
  probe: DelegatedCapabilityProbeSpec,
): Promise<RunCapabilityProbeResult> {
  if (probe.suiteId === 'capability' && probe.testId === 'cap-multimodal') {
    return runDelegatedCapMultimodal(ctx);
  }

  if (probe.suiteId === 'skills') {
    const skillId = skillIdFromDelegatedTestId(probe.testId);
    if (!skillId) {
      return {
        skipped: true,
        skipReason: 'unknown delegated skills test',
        verdict: 'n-a',
        reason: `unknown delegated skills test: ${probe.testId}`,
      };
    }
    return runDelegatedSkillProbe(ctx, skillId);
  }

  return {
    skipped: true,
    skipReason: 'unknown delegated probe',
    verdict: 'n-a',
    reason: `unknown delegation ${probe.suiteId}/${probe.testId}`,
  };
}
