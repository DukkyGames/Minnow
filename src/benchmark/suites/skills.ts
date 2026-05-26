/**
 * Skills suite: built-in slash skills with per-skill probes (text regex and/or tool calls).
 */

import builtinManifest from '../../skills/builtin-manifest.json';
import { fetchSkillById, refreshSkillCatalog } from '../../skills/client';
import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { createBenchmarkExecuteToolFn } from '../execute-tool-sandbox.ts';
import { runOneShot, runToolLoop } from '../llm-driver.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';
import {
  evaluateSkillProbe,
  getSkillProbe,
  resolveSkillProbeSkip,
  resolveSkillProbeTools,
} from './skill-probes.ts';

function skillRunDetails(
  evaluation: { passed: boolean; details: string },
  extras: {
    skillLoaded: boolean;
    systemChars: number;
    responseChars: number;
  },
): string {
  const flags = [
    extras.skillLoaded ? 'skill loaded' : 'skill body missing',
    `${extras.systemChars} sys chars`,
    `${extras.responseChars} resp chars`,
  ].join('; ');
  return `${evaluation.details} (${flags})`;
}

export async function runSkillsSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const skills = builtinManifest.skills ?? [];

  await refreshSkillCatalog();

  for (const skill of skills) {
    assertNotAborted(ctx.signal);
    const probe = getSkillProbe(skill.id);
    const t0 = performance.now();
    announceTestStart(ctx, {
      testId: `skill-${skill.id}`,
      suite: 'skills',
      label: skill.label,
    });

    const skipReason = resolveSkillProbeSkip(probe, ctx);
    if (skipReason) {
      reportTest(ctx, tests, {
        testId: `skill-${skill.id}`,
        suite: 'skills',
        label: skill.label,
        passed: false,
        skipped: true,
        skipReason,
        durationMs: performance.now() - t0,
        score: 0,
        details: skipReason,
      });
      continue;
    }

    try {
      const detail = await fetchSkillById(skill.id);
      const system = detail?.body?.trim() ?? '';
      const skillLoaded = system.length > 0;

      if (!skillLoaded) {
        reportTest(ctx, tests, {
          testId: `skill-${skill.id}`,
          suite: 'skills',
          label: skill.label,
          passed: false,
          skipped: true,
          skipReason: 'skill body not loaded',
          durationMs: performance.now() - t0,
          score: 0,
          details: 'skill body not loaded',
        });
        continue;
      }

      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: probe.prompt },
      ];

      const tools = resolveSkillProbeTools(probe);
      const useToolLoop = tools.length > 0;

      const out = useToolLoop
        ? await runToolLoop({
            providerId: ctx.providerId,
            modelId: ctx.modelId,
            signal: ctx.signal,
            messages,
            tools,
            maxToolRounds: 2,
            executeToolFn: createBenchmarkExecuteToolFn(),
          })
        : await runOneShot({
            providerId: ctx.providerId,
            modelId: ctx.modelId,
            signal: ctx.signal,
            messages,
          });

      const evaluation = evaluateSkillProbe(probe, out);
      const responseChars = out.text.trim().length;

      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `skill-${skill.id}`,
            suite: 'skills',
            label: skill.label,
            passed: evaluation.passed,
            skipped: false,
            durationMs: performance.now() - t0,
            score: evaluation.passed ? 1 : 0,
            details: skillRunDetails(evaluation, {
              skillLoaded,
              systemChars: system.length,
              responseChars,
            }),
          },
          out,
        ),
      );
    } catch (err) {
      rethrowIfAborted(err, ctx.signal);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `skill-${skill.id}`,
            suite: 'skills',
            label: skill.label,
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

  const passed = tests.filter((t) => t.passed).length;
  const skipped = tests.filter((t) => t.skipped).length;
  const failed = tests.length - passed - skipped;

  return {
    id: 'skills',
    label: 'Skills',
    passed,
    failed,
    skipped,
    score: tests.length ? passed / tests.length : 0,
    tests,
  };
}
