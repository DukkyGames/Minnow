/**

 * Capability matrix suite: one row per spreadsheet capability (67 probes).

 */



import { fetchModelsForProvider } from '../../providers/fetch-models.ts';

import { getActiveProvider } from '../../providers/store.ts';

import { ensureCapabilityMatrixFixturesReady } from '../capabilities/fixtures-workspace.ts';
import { getBenchmarkWorkspacePath } from '../../lib/benchmark-workspace.ts';

import { CAPABILITY_CATALOG } from '../capabilities/catalog.ts';

import {

  resolveCapabilityProbeSkip,

  type CapabilityProbeEnvironment,

} from '../capabilities/probe-requirements.ts';
import { resolveMatrixRunFilterSkip } from '../capabilities/matrix-run-filters.ts';

import {

  capabilityTestFieldsFromVerdict,

  runCapabilityProbe,

} from '../capabilities/run-probe.ts';

import { capabilityRowScore } from '../capabilities/score.ts';

import type { CapabilityScoredVerdict, CapabilityVerdict } from '../capabilities/types.ts';

import { computeSuiteResultStats } from '../scoring.ts';

import { capabilityMatrixTestId } from '../test-catalog.ts';

import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';

import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';



async function buildProbeEnvironment(ctx: BenchmarkRunContext): Promise<CapabilityProbeEnvironment> {

  const env: CapabilityProbeEnvironment = { ctx };

  if (ctx.localServer) {

    env.workspaceRoot = await getBenchmarkWorkspacePath().catch(() => null);

  }

  try {

    const provider = await getActiveProvider(ctx.providerId);

    env.catalogModels = await fetchModelsForProvider(provider, ctx.signal);

  } catch {

    env.catalogModels = undefined;

  }

  return env;

}



export async function runCapabilityMatrixSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {

  const tests: TestResult[] = [];

  const verdicts: CapabilityVerdict[] = [];

  const probeEnv = await buildProbeEnvironment(ctx);

  if (ctx.localServer && probeEnv.workspaceRoot) {
    try {
      await ensureCapabilityMatrixFixturesReady(probeEnv.workspaceRoot);
      probeEnv.capabilityFixturesSeeded = true;
    } catch {
      probeEnv.capabilityFixturesSeeded = false;
    }
  }

  for (const cap of CAPABILITY_CATALOG) {

    const testId = capabilityMatrixTestId(cap.id);

    const t0 = performance.now();

    announceTestStart(ctx, {

      testId,

      suite: 'capability-matrix',

      label: cap.header,

    });



    const filterSkip = resolveMatrixRunFilterSkip(cap, ctx.capabilityMatrix);
    if (filterSkip) {
      const verdict: CapabilityVerdict = 'n-a';
      verdicts.push(verdict);
      reportTest(ctx, tests, {
        testId,
        suite: 'capability-matrix',
        label: cap.header,
        passed: false,
        skipped: true,
        skipReason: filterSkip,
        durationMs: performance.now() - t0,
        score: 0,
        verdict,
        details: filterSkip,
      });
      continue;
    }

    const skipReason = await resolveCapabilityProbeSkip(cap, probeEnv);

    if (skipReason) {

      const verdict: CapabilityVerdict = 'n-a';

      verdicts.push(verdict);

      reportTest(ctx, tests, {

        testId,

        suite: 'capability-matrix',

        label: cap.header,

        passed: false,

        skipped: true,

        skipReason,

        durationMs: performance.now() - t0,

        score: 0,

        verdict,

        details: cap.scoreMode === 'manual' ? 'manual row' : skipReason,

      });

      continue;

    }



    const probeResult = await runCapabilityProbe(ctx, cap, {

      workspaceRoot: probeEnv.workspaceRoot ?? undefined,

    });

    const durationMs = performance.now() - t0;



    if (probeResult.skipped) {

      const verdict: CapabilityVerdict = 'n-a';

      verdicts.push(verdict);

      reportTest(ctx, tests, {

        testId,

        suite: 'capability-matrix',

        label: cap.header,

        passed: false,

        skipped: true,

        skipReason: probeResult.skipReason ?? probeResult.reason,

        durationMs,

        score: 0,

        verdict,

        details: probeResult.reason,

      });

      continue;

    }



    const scored = probeResult.verdict as CapabilityScoredVerdict;

    const fields = capabilityTestFieldsFromVerdict(scored, probeResult.reason);

    verdicts.push(scored);



    reportTest(

      ctx,

      tests,

      buildTestResult(

        {

          testId,

          suite: 'capability-matrix',

          label: cap.header,

          passed: fields.passed,

          skipped: false,

          durationMs,

          score: fields.score,

          verdict: scored,

          details: fields.details,

          ttftMs: probeResult.oneShot?.timing.ttftMs ?? undefined,

          tokPerSec: probeResult.oneShot?.timing.tokPerSec ?? undefined,

        },

        probeResult.oneShot,

      ),

    );

  }



  const stats = computeSuiteResultStats(tests);

  const matrixScore = capabilityRowScore(verdicts);



  return {

    id: 'capability-matrix',

    label: 'Capability matrix',

    ...stats,

    score: matrixScore ?? 0,

    tests,

  };

}

