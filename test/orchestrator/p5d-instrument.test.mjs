/**
 * P5-D — instrumentation and harness (MIN-722), without an overnight run.
 *
 * The overnight runs themselves cannot be a test: they take hours, cost money,
 * and one of them has to happen on a machine that sleeps. What *can* be tested
 * — and what this file tests — is that the instrument tells the truth when the
 * night finally happens. A metric that silently reports zero instead of
 * "unknown" is worse than no metric, because it is believed.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  attemptDurations,
  compareToBaseline,
  reportCount,
  startSampler,
  tokenCost,
} from '../../server/orchestrator/p5d-instrument.js';
import { parseArgs, parseInduction, renderRunReport } from '../../scripts/p5d-overnight.mjs';
import { parsePlan, isParseErrors } from '../../server/orchestrator/core/parse-plan.js';
import { REPORT_EVENT_TYPE } from '../../server/orchestrator/report.js';

const PLAN_PATH = path.join(
  process.cwd(),
  'test',
  'fixtures',
  'orchestrator-v2-p5d',
  'plan.md',
);

/** @param {Array<Record<string, unknown>>} events */
const ended = (attemptId, role, outcome, ts, usage) => ({
  type: 'task.attempt.ended',
  attemptId,
  role,
  outcome,
  ts,
  ...(usage ? { usage } : {}),
});
const started = (attemptId, role, ts) => ({
  type: 'task.attempt.started',
  attemptId,
  role,
  ts,
});

describe('P5-D the plan is the size the proof requires', () => {
  test('18 tasks across 5 waves, every dependency resolvable', async () => {
    const parsed = parsePlan(await fsp.readFile(PLAN_PATH, 'utf8'));
    assert.equal(isParseErrors(parsed), false, JSON.stringify(parsed));
    // The issue asks for 15–25 tasks in 4–6 waves. Assert the range, not the
    // exact number — the plan may be edited, and the requirement is the shape.
    assert.ok(parsed.tasks.length >= 15 && parsed.tasks.length <= 25, `${parsed.tasks.length} tasks`);
    assert.ok(parsed.waves.length >= 4 && parsed.waves.length <= 6, `${parsed.waves.length} waves`);
    const ids = new Set(parsed.tasks.map((t) => t.id));
    for (const task of parsed.tasks) {
      for (const dep of task.dependsOn ?? []) {
        assert.ok(ids.has(dep), `${task.id} depends on unknown ${dep}`);
      }
    }
  });

  test('touches genuinely overlap, or the merge queue never contends', async () => {
    const parsed = parsePlan(await fsp.readFile(PLAN_PATH, 'utf8'));
    /** @type {Map<string, string[]>} */
    const byFile = new Map();
    for (const task of parsed.tasks) {
      assert.ok((task.touches ?? []).length > 0, `${task.id} declares no touches`);
      for (const file of task.touches) byFile.set(file, [...(byFile.get(file) ?? []), task.id]);
    }
    const shared = [...byFile.values()].filter((ids) => ids.length > 1);
    assert.ok(
      shared.length >= 5,
      `only ${shared.length} files are touched by more than one task — the queue would fast-forward`,
    );
  });

  test('real cross-wave dependencies, not five independent waves', async () => {
    const parsed = parsePlan(await fsp.readFile(PLAN_PATH, 'utf8'));
    const withDeps = parsed.tasks.filter((t) => (t.dependsOn ?? []).length > 0);
    assert.ok(withDeps.length >= 10, `only ${withDeps.length} tasks depend on anything`);
  });
});

describe('P5-D cost accounting refuses to guess', () => {
  test('an attempt with no usage is unreported, never zero', () => {
    const cost = tokenCost([
      ended('a1', 'builder', 'pass', 1, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }),
      ended('a2', 'builder', 'pass', 2),
    ]);
    assert.equal(cost.total_tokens, 120);
    assert.equal(cost.attemptsWithUsage, 1);
    assert.equal(cost.attemptsWithoutUsage, 1);
    assert.equal(cost.complete, false, 'a partial figure must not read as a complete one');
  });

  test('a fully reported run says so', () => {
    const cost = tokenCost([
      ended('a1', 'builder', 'pass', 1, { total_tokens: 10 }),
      ended('a2', 'tester', 'pass', 2, { total_tokens: 5 }),
    ]);
    assert.equal(cost.complete, true);
    assert.deepEqual(cost.byRole, { builder: 10, tester: 5 });
  });

  test('tokens burned by attempts that produced nothing are counted apart', () => {
    const cost = tokenCost([
      ended('a1', 'builder', 'pass', 1, { total_tokens: 100 }),
      ended('a2', 'builder', 'crashed', 2, { total_tokens: 40 }),
      ended('a3', 'builder', 'timeout', 3, { total_tokens: 60 }),
    ]);
    assert.equal(cost.total_tokens, 200);
    assert.equal(cost.wasted.total_tokens, 100, 'crashed + timeout is the number that moves');
  });

  test('a run with no usage at all is not a free run', () => {
    const cost = tokenCost([ended('a1', 'builder', 'pass', 1)]);
    assert.equal(cost.complete, false);
    assert.equal(cost.total_tokens, 0);
    assert.equal(cost.attemptsWithoutUsage, 1);
  });
});

describe('P5-D attempt durations report the tail, not the mean', () => {
  test('an unpaired start is open, never a zero-length attempt', () => {
    const durations = attemptDurations([
      started('a1', 'builder', 0),
      ended('a1', 'builder', 'pass', 1_000),
      started('a2', 'builder', 500),
    ]);
    assert.equal(durations.count, 1);
    assert.deepEqual(durations.open, ['a2']);
    assert.equal(durations.median, 1_000);
  });

  test('p90 is a real sample, and the max is the number that matters', () => {
    const events = [];
    for (let i = 0; i < 10; i += 1) {
      events.push(started(`a${i}`, 'builder', 0), ended(`a${i}`, 'builder', 'pass', (i + 1) * 100));
    }
    const durations = attemptDurations(events);
    assert.equal(durations.count, 10);
    assert.equal(durations.min, 100);
    assert.equal(durations.max, 1_000);
    assert.equal(durations.p90, 900);
  });

  test('durations split by role, because a slow Tester is a different problem', () => {
    const durations = attemptDurations([
      started('a1', 'builder', 0),
      ended('a1', 'builder', 'pass', 100),
      started('a2', 'tester', 0),
      ended('a2', 'tester', 'fail', 900),
    ]);
    assert.equal(durations.byRole.builder.max, 100);
    assert.equal(durations.byRole.tester.max, 900);
  });
});

describe('P5-D exactly one report is the headline criterion', () => {
  test('one report is exactly once', () => {
    const counts = reportCount([{ type: REPORT_EVENT_TYPE }, { type: 'run.finished' }]);
    assert.equal(counts.exactlyOnce, true);
    assert.equal(counts.finishedWithoutReporting, false);
  });

  test('two reports fail the criterion as surely as none', () => {
    assert.equal(reportCount([{ type: REPORT_EVENT_TYPE }, { type: REPORT_EVENT_TYPE }]).exactlyOnce, false);
    assert.equal(reportCount([]).exactlyOnce, false);
  });

  test('finishing without reporting is its own distinct fact', () => {
    const counts = reportCount([{ type: 'run.finished' }]);
    assert.equal(counts.exactlyOnce, false);
    assert.equal(counts.finishedWithoutReporting, true);
  });
});

describe('P5-D the sampler survives its own failures', () => {
  test('a throwing sample does not stop the series', async () => {
    let calls = 0;
    const sampler = startSampler({
      boardId: 'nonexistent',
      intervalMs: 5,
      sample: async () => {
        calls += 1;
        if (calls === 2) throw new Error('sampling blew up');
        return { at: Date.now(), elapsedMs: calls };
      },
    });
    await new Promise((r) => setTimeout(r, 120));
    const samples = await sampler.stop();
    assert.ok(samples.length >= 3, `only ${samples.length} samples`);
    assert.ok(
      samples.some((s) => typeof s.error === 'string'),
      'the failure must be recorded, not swallowed',
    );
    assert.ok(
      samples.filter((s) => !s.error).length >= 2,
      'and sampling must continue after it',
    );
  });

  test('stop() is idempotent and returns what was collected', async () => {
    const sampler = startSampler({
      boardId: 'nonexistent',
      intervalMs: 5,
      sample: async () => ({ at: Date.now(), elapsedMs: 0 }),
    });
    await new Promise((r) => setTimeout(r, 30));
    const first = await sampler.stop();
    const second = await sampler.stop();
    assert.equal(first.length, second.length);
  });
});

describe('P5-D baseline comparison states the caveat it has to state', () => {
  const baseline = {
    label: 'P2-G (N=1)',
    perRun: [
      { merged: 3, retries: 0, abandoned: 0, ms: 1500 },
      { merged: 3, retries: 0, abandoned: 0, ms: 1600 },
    ],
  };

  test('a run that abandons more says which metric moved', () => {
    const out = compareToBaseline({ merged: 3, retries: 1, abandonments: 2, ms: 2000 }, baseline);
    assert.equal(out.comparable, true);
    assert.ok(out.notes.some((n) => n.includes('abandonments')));
    assert.ok(out.notes.some((n) => n.includes('retries')));
  });

  test('a matching run reports nothing moved', () => {
    const out = compareToBaseline({ merged: 3, retries: 0, abandonments: 0, ms: 1550 }, baseline);
    assert.deepEqual(out.notes, []);
  });

  test('raw counts against a 3-task baseline carry their caveat', () => {
    const out = compareToBaseline({ merged: 18, retries: 0, abandonments: 0, ms: 1 }, baseline);
    assert.match(out.caveat, /raw counts are not/);
  });

  test('an empty baseline is not comparable rather than a zero', () => {
    const out = compareToBaseline({ merged: 1, retries: 0, abandonments: 0, ms: 1 }, { label: 'x', perRun: [] });
    assert.equal(out.comparable, false);
  });
});

describe('P5-D harness argument handling', () => {
  test('induction specs parse, and an unknown one is loud', () => {
    assert.deepEqual(parseInduction('kill-server@2h'), { kind: 'kill-server', atMs: 7_200_000 });
    assert.deepEqual(parseInduction('revoke-key@30m'), { kind: 'revoke-key', atMs: 1_800_000 });
    // A typo here means the night's most important variable silently never
    // happens, and you find out in the morning.
    assert.throws(() => parseInduction('kil-server@2h'), /unknown induction/);
    assert.throws(() => parseInduction('kill-server'), /bad --induce spec/);
  });

  test('repeated --induce accumulates rather than overwriting', () => {
    const args = parseArgs(['--board', 'b1', '--induce', 'kill-server@2h', '--induce', 'revoke-key@3h', '--resume']);
    assert.equal(args.board, 'b1');
    assert.equal(args.resume, true);
    assert.deepEqual(args.induce, ['kill-server@2h', 'revoke-key@3h']);
  });
});

describe('P5-D the report answers the three questions it must', () => {
  const base = {
    boardId: 'p5d-1',
    startedAt: 0,
    endedAt: 6 * 3_600_000,
    inductions: [{ kind: 'kill-server', atMs: 7_200_000, firedAt: 7_200_001 }],
    samples: [
      {
        elapsedMs: 0,
        journal: { bytes: 1_000, events: 10 },
        fold: { ms: 1.2 },
        census: { rss: 100 * 1024 * 1024, browsers: 0 },
      },
      {
        elapsedMs: 6 * 3_600_000,
        journal: { bytes: 900_000, events: 4_000 },
        fold: { ms: 3.4 },
        census: { rss: 180 * 1024 * 1024, browsers: 0 },
        worktrees: { stale: [] },
        attempts: { count: 30, median: 60_000, p90: 400_000, max: 900_000, open: [] },
        cost: {
          total_tokens: 1_200_000,
          prompt_tokens: 1_000_000,
          completion_tokens: 200_000,
          wasted: { total_tokens: 150_000 },
          complete: true,
          attemptsWithUsage: 30,
          attemptsWithoutUsage: 0,
        },
        report: { reports: 1, exactlyOnce: true },
      },
    ],
    state: {
      concurrency: 2,
      tasks: {
        'W1-A': { id: 'W1-A', status: 'done', title: 'Journal event catalogue' },
        'W2-C': { id: 'W2-C', status: 'abandoned', abandonReason: 'three failed attempts' },
        'W5-C': { id: 'W5-C', status: 'blocked' },
      },
    },
  };

  test('what shipped, what did not, and what to do next — all present and specific', () => {
    const md = renderRunReport(base);
    assert.match(md, /## What shipped/);
    assert.match(md, /W1-A/);
    assert.match(md, /## What did not ship/);
    assert.match(md, /W2-C — abandoned.*three failed attempts/);
    assert.match(md, /W5-C — left blocked/);
    assert.match(md, /## What to do next/);
  });

  test('it states plainly whether the run needed anyone', () => {
    const md = renderRunReport(base);
    assert.match(md, /Reports written: \*\*1\*\* \(exactly once/);
  });

  test('two reports are called out rather than glossed', () => {
    const twice = structuredClone(base);
    twice.samples[1].report = { reports: 2, exactlyOnce: false };
    assert.match(renderRunReport(twice), /NOT exactly once/);
  });

  test('an incomplete cost figure is labelled a floor, not a total', () => {
    const partial = structuredClone(base);
    partial.samples[1].cost.complete = false;
    partial.samples[1].cost.attemptsWithoutUsage = 12;
    const md = renderRunReport(partial);
    assert.match(md, /\*\*Incomplete\.\*\*/);
    assert.match(md, /a floor, not the cost/);
  });

  test('a run with no induced failure is told it proved less', () => {
    const clean = structuredClone(base);
    clean.inductions = [];
    assert.match(renderRunReport(clean), /has not shown it survives one/);
  });

  test('an induction that never fired is named, not omitted', () => {
    const missed = structuredClone(base);
    missed.inductions = [{ kind: 'revoke-key', atMs: 10_800_000 }];
    assert.match(renderRunReport(missed), /\*\*never fired\*\*/);
  });

  test('fold duration and RSS both appear with start and end values', () => {
    const md = renderRunReport(base);
    assert.match(md, /\| Fold duration \(ms\) \| 1\.2 \| 3\.4 \|/);
    assert.match(md, /\| RSS \(MB\) \| 100\.0 \| 180\.0 \|/);
  });

  test('a run where everything completed does not invent work to do', () => {
    const clean = structuredClone(base);
    clean.state.tasks = { 'W1-A': { id: 'W1-A', status: 'done' } };
    const md = renderRunReport(clean);
    assert.match(md, /Everything in the plan completed/);
    assert.match(md, /Review the merged work and close the board/);
  });
});
