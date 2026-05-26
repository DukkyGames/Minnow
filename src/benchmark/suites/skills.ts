/**
 * Skills suite: built-in slash skills compose and respond to trigger prompts.
 */

import builtinManifest from '../../skills/builtin-manifest.json';
import { fetchSkillById } from '../../skills/client';
import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { regexMatch } from '../scoring.ts';
import { runOneShot } from '../llm-driver.ts';
import { buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';

const SKILL_TRIGGERS: Record<string, { prompt: string; pattern: RegExp }> = {
  'ask-user': {
    prompt: 'I need to choose between REST and GraphQL for a small API. What should you ask me?',
    pattern: /question|clarif|option|prefer/i,
  },
  'explain-code': {
    prompt: 'Explain what Array.prototype.map does in one paragraph.',
    pattern: /map|callback|array|element/i,
  },
  'debug-error': {
    prompt: 'Tool failed with Error: ENOENT. How do you debug this?',
    pattern: /path|file|exist|ENOENT|check/i,
  },
  impeccable: {
    prompt: 'Polish the login button spacing on a settings page.',
    pattern: /design|UI|spacing|layout|interface/i,
  },
};

export async function runSkillsSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];
  const skills = builtinManifest.skills ?? [];

  for (const skill of skills) {
    assertNotAborted(ctx.signal);
    const t0 = performance.now();
    const trigger = SKILL_TRIGGERS[skill.id] ?? {
      prompt: `Follow the ${skill.id} skill instructions. Acknowledge the skill topic briefly.`,
      pattern: new RegExp(skill.label.split(/\s+/)[0]!, 'i'),
    };

    try {
      const detail = await fetchSkillById(skill.id);
      const system = detail?.body?.trim() ?? '';
      const out = await runOneShot({
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        signal: ctx.signal,
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user', content: trigger.prompt },
        ],
      });
      const passed = regexMatch(out.text, trigger.pattern);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: `skill-${skill.id}`,
            suite: 'skills',
            label: skill.label,
            passed,
            skipped: false,
            durationMs: performance.now() - t0,
            score: passed ? 1 : 0,
            details: out.text.slice(0, 100),
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
  const failed = tests.length - passed;

  return {
    id: 'skills',
    label: 'Skills',
    passed,
    failed,
    skipped: 0,
    score: tests.length ? passed / tests.length : 0,
    tests,
  };
}
