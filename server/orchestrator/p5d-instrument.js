/**
 * P5-D — instrumentation for the unattended overnight proof (MIN-722).
 *
 * Everything here answers one question: *did the run need anyone?* Not whether
 * it finished — a run that finishes because someone nudged it at 3am has proved
 * nothing. The failure modes this exists to catch are the ones that only appear
 * over hours, and each of them is invisible to a pass/fail:
 *
 * - a slow leak in the effector's running map,
 * - a journal that grows until the fold is the slowest thing in the loop,
 * - a browser or a worktree that accumulates one orphan per attempt,
 * - a provider that starts rate-limiting at hour three,
 * - a cost that quietly makes the whole approach uneconomic.
 *
 * ## Why this is separate from the plan it measures
 *
 * `test/fixtures/orchestrator-v2-p5d/plan.md` is the *subject* of the overnight
 * run, not its implementation. It is real work of a realistic size, and the
 * agents do it. This module is the observer, and it deliberately shares no code
 * with what the agents are asked to build — an instrument that the run under
 * measurement can modify is not an instrument.
 *
 * ## Everything here is derived from the journal
 *
 * Not from a live listener attached before the run started. That matters for
 * the induced-failure part of the proof: when the server is killed at hour two,
 * an in-memory observer dies with it, and the numbers for the first two hours
 * die too. The journal survives, so the measurement does. Samples of things the
 * journal cannot know — RSS, live process counts — are the only exception, and
 * they are timestamped so a gap in them is visible as a gap rather than
 * silently interpolated.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { derive } from './core/derive.js';
import { journalPath, readEvents } from './journal.js';
import { REPORT_EVENT_TYPE } from './report.js';

/** Percentile helper. Nearest-rank, so a 3-sample p90 is a real sample. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * Journal size on disk, and how many events are in it.
 *
 * Size is the thing that grows without bound; event count is what makes it
 * interpretable. A journal that is large because the run was long is fine; one
 * that is large because a single event type is repeating is a leak.
 *
 * @param {string} boardId
 * @returns {Promise<{ bytes: number, events: number, byType: Record<string, number> }>}
 */
export async function journalSize(boardId) {
  let bytes = 0;
  try {
    bytes = (await fsp.stat(journalPath(boardId))).size;
  } catch {
    bytes = 0;
  }
  const events = await readEvents(boardId);
  /** @type {Record<string, number>} */
  const byType = {};
  for (const event of events) {
    const type = String(event?.type ?? 'unknown');
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return { bytes, events: events.length, byType };
}

/**
 * How long one fold of the whole journal takes, right now.
 *
 * This is the number P0-G's snapshot exists to keep flat, and the overnight run
 * is the first time it is measured at real scale. If it climbs with the journal
 * rather than staying flat, the snapshot is not doing its job — and the symptom
 * in production is a board that gets progressively less responsive over a night
 * rather than one that fails.
 *
 * @param {string} boardId
 * @returns {Promise<{ ms: number, events: number }>}
 */
export async function foldDuration(boardId) {
  const events = await readEvents(boardId);
  const started = process.hrtime.bigint();
  derive(events);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, events: events.length };
}

/**
 * The wall-clock distribution of attempts.
 *
 * The mean is useless here — what matters is the tail. One attempt that took
 * forty minutes because a provider was throttling is the thing that turns a
 * six-hour run into a twelve-hour one, and it disappears into an average.
 *
 * An attempt with no `ended` is reported as `open`, never as duration zero: at
 * the end of a completed run an open attempt is itself a finding.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function attemptDurations(events) {
  /** @type {Map<string, { role: string, startedAt: number }>} */
  const open = new Map();
  /** @type {Array<{ attemptId: string, role: string, ms: number }>} */
  const finished = [];

  for (const event of events) {
    const ts = Number(event?.ts);
    const attemptId = String(event?.attemptId ?? '');
    if (!attemptId || !Number.isFinite(ts)) continue;
    if (event.type === 'task.attempt.started') {
      open.set(attemptId, { role: String(event.role ?? '?'), startedAt: ts });
    } else if (event.type === 'task.attempt.ended') {
      const start = open.get(attemptId);
      if (!start) continue;
      open.delete(attemptId);
      finished.push({ attemptId, role: start.role, ms: Math.max(0, ts - start.startedAt) });
    }
  }

  const sorted = finished.map((a) => a.ms).sort((a, b) => a - b);
  /** @type {Record<string, number[]>} */
  const byRole = {};
  for (const attempt of finished) {
    (byRole[attempt.role] ??= []).push(attempt.ms);
  }

  return {
    count: finished.length,
    open: [...open.keys()],
    min: sorted[0] ?? null,
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1] ?? null,
    totalMs: sorted.reduce((sum, ms) => sum + ms, 0),
    byRole: Object.fromEntries(
      Object.entries(byRole).map(([role, list]) => {
        const s = [...list].sort((a, b) => a - b);
        return [role, { count: s.length, median: percentile(s, 50), max: s[s.length - 1] ?? null }];
      }),
    ),
  };
}

/**
 * What the run cost, in tokens.
 *
 * Co-Coder's finding — +60% cost for +3.2% correctness — is the number V2 has
 * to be checked against, and it cannot be checked without this one. Attempts
 * whose provider reported no usage are counted separately and never as zero:
 * a run that is 80% unreported has no cost figure, and saying so is the honest
 * answer rather than reporting the 20% as if it were the total.
 *
 * `wasted` is the cost of attempts that produced nothing — crashed, timed out,
 * abandoned. That is the number that moves when reliability slips, and it is
 * invisible in a total.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function tokenCost(events) {
  const total = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const wasted = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  /** @type {Record<string, number>} */
  const byRole = {};
  let attemptsWithUsage = 0;
  let attemptsWithoutUsage = 0;

  const NO_PRODUCT = new Set(['crashed', 'timeout', 'no_report']);

  for (const event of events) {
    if (event?.type !== 'task.attempt.ended') continue;
    const usage = event.usage;
    if (!usage || typeof usage !== 'object') {
      attemptsWithoutUsage += 1;
      continue;
    }
    attemptsWithUsage += 1;
    const role = String(event.role ?? '?');
    const totalTokens = Number(usage.total_tokens ?? 0);
    for (const key of Object.keys(total)) {
      const value = Number(usage[key]);
      if (Number.isFinite(value)) total[key] += value;
    }
    if (Number.isFinite(totalTokens)) byRole[role] = (byRole[role] ?? 0) + totalTokens;
    if (NO_PRODUCT.has(String(event.outcome))) {
      for (const key of Object.keys(wasted)) {
        const value = Number(usage[key]);
        if (Number.isFinite(value)) wasted[key] += value;
      }
    }
  }

  return {
    ...total,
    wasted,
    byRole,
    attemptsWithUsage,
    attemptsWithoutUsage,
    // Without this flag a partial figure reads like a complete one.
    complete: attemptsWithoutUsage === 0 && attemptsWithUsage > 0,
  };
}

/**
 * Did the run report exactly once?
 *
 * The headline criterion, and the easiest to get wrong in a way nobody notices:
 * a run that reports twice is as much a failure of "set and forget" as one that
 * never reports, because the second report trains you to check.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function reportCount(events) {
  const reports = events.filter((event) => event?.type === REPORT_EVENT_TYPE);
  const finishes = events.filter((event) => event?.type === 'run.finished');
  return {
    reports: reports.length,
    finishes: finishes.length,
    // One report, and a run that actually reached the end. A run that finished
    // without reporting and one that reported twice are different bugs, so the
    // two counts stay separate rather than collapsing into a boolean.
    exactlyOnce: reports.length === 1,
    finishedWithoutReporting: finishes.length > 0 && reports.length === 0,
  };
}

/**
 * Live counts the journal cannot know: this process's memory, and the browser
 * and worktree processes still on the machine.
 *
 * Sampled rather than derived, so each carries the time it was taken. A gap in
 * the series is a gap, not a straight line between two points — during a
 * server kill the truth is "unknown", and interpolating over it would hide
 * exactly the interval the proof cares about.
 */
export async function census() {
  const memory = process.memoryUsage();
  /** @type {number[]} */
  let browsers = [];
  try {
    const driver = await import('../browser-driver/index.js');
    browsers = typeof driver.trackedBrowserPids === 'function' ? driver.trackedBrowserPids() : [];
  } catch {
    browsers = [];
  }
  return {
    at: Date.now(),
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    external: memory.external,
    browsers: browsers.length,
    browserPids: browsers,
  };
}

/**
 * Worktrees still on disk for a board, and whether the journal thinks any
 * attempt is still using them.
 *
 * One orphan is a bug; one orphan *per run* is the thing that fills a disk
 * overnight and is invisible in a single-run test.
 *
 * @param {string} boardId
 * @param {string} worktreeRoot directory the board's slot worktrees live under
 */
export async function worktreeCensus(boardId, worktreeRoot) {
  /** @type {string[]} */
  let onDisk = [];
  try {
    const entries = await fsp.readdir(worktreeRoot, { withFileTypes: true });
    onDisk = entries.filter((e) => e.isDirectory()).map((e) => path.join(worktreeRoot, e.name));
  } catch {
    onDisk = [];
  }
  const events = await readEvents(boardId);
  const state = derive(events);
  const live = new Set();
  for (const task of Object.values(state?.tasks ?? {})) {
    for (const attempt of task?.attempts ?? []) {
      if (!attempt?.ended && attempt?.worktree) live.add(path.resolve(attempt.worktree));
    }
  }
  return {
    onDisk: onDisk.length,
    live: live.size,
    stale: onDisk.filter((dir) => !live.has(path.resolve(dir))),
  };
}

/**
 * One complete sample: everything above, at one instant.
 *
 * @param {{ boardId: string, worktreeRoot?: string | null, startedAt: number }} input
 */
export async function takeSample(input) {
  const { boardId, startedAt } = input;
  /** @type {Record<string, unknown>} */
  const sample = { at: Date.now(), elapsedMs: Date.now() - startedAt };
  // Each measurement is independently guarded. A sampler that throws stops
  // sampling, and a run with no samples after hour two is a run that cannot be
  // diagnosed — which is the failure this whole module exists to prevent.
  for (const [key, fn] of /** @type {const} */ ([
    ['journal', () => journalSize(boardId)],
    ['fold', () => foldDuration(boardId)],
    ['census', () => census()],
    [
      'worktrees',
      () => (input.worktreeRoot ? worktreeCensus(boardId, input.worktreeRoot) : null),
    ],
  ])) {
    try {
      sample[key] = await fn();
    } catch (err) {
      sample[key] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  try {
    const events = await readEvents(boardId);
    sample.attempts = attemptDurations(events);
    sample.cost = tokenCost(events);
    sample.report = reportCount(events);
  } catch (err) {
    sample.derivedError = err instanceof Error ? err.message : String(err);
  }
  return sample;
}

/**
 * Sample on an interval until stopped.
 *
 * The loop is `setTimeout`-chained rather than `setInterval` so a slow sample
 * (a fold over a large journal is not instant) delays the next one instead of
 * stacking behind it. Over a night, stacking is how a sampler becomes the load.
 *
 * @param {{
 *   boardId: string,
 *   worktreeRoot?: string | null,
 *   intervalMs?: number,
 *   onSample?: (sample: Record<string, unknown>) => void,
 *   sample?: (input: { boardId: string, worktreeRoot?: string | null, startedAt: number }) => Promise<Record<string, unknown>>,
 * }} options
 */
export function startSampler(options) {
  const intervalMs = options.intervalMs ?? 60_000;
  const startedAt = Date.now();
  const take = options.sample ?? takeSample;
  /** @type {Array<Record<string, unknown>>} */
  const samples = [];
  let stopped = false;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {Promise<void>} */
  let inFlight = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    try {
      const sample = await take({
        boardId: options.boardId,
        worktreeRoot: options.worktreeRoot ?? null,
        startedAt,
      });
      samples.push(sample);
      options.onSample?.(sample);
    } catch (err) {
      // Never stop. A failed sample is a data point, not the end of the series.
      samples.push({
        at: Date.now(),
        elapsedMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = tick();
    }, intervalMs);
    if (timer.unref) timer.unref();
  };

  inFlight = tick();

  return {
    samples,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight.catch(() => {});
      return samples;
    },
  };
}

/**
 * Compare a run against the recorded P2-G (N=1) and P3-E (N=2) baselines.
 *
 * States what moved and in which direction. It does not decide whether the run
 * "passed" — that is a judgement about a specific plan on a specific night, and
 * a function that pretends to make it would be believed.
 *
 * @param {{ merged: number, retries: number, abandonments: number, ms: number }} run
 * @param {{ label: string, perRun: Array<{ merged: number, retries: number, abandoned: number, ms: number }> }} baseline
 */
export function compareToBaseline(run, baseline) {
  const rows = baseline?.perRun ?? [];
  if (rows.length === 0) {
    return { label: baseline?.label ?? 'unknown', comparable: false, notes: ['baseline is empty'] };
  }
  const mean = (pick) => rows.reduce((sum, row) => sum + Number(pick(row) ?? 0), 0) / rows.length;
  const base = {
    merged: mean((r) => r.merged),
    retries: mean((r) => r.retries),
    abandonments: mean((r) => r.abandoned),
    ms: mean((r) => r.ms),
  };
  /** @type {string[]} */
  const notes = [];
  const delta = {};
  for (const key of /** @type {const} */ (['merged', 'retries', 'abandonments', 'ms'])) {
    const observed = Number(run?.[key] ?? 0);
    delta[key] = { baseline: base[key], observed, change: observed - base[key] };
    if (key === 'merged') continue;
    if (observed > base[key]) notes.push(`${key} rose from ${base[key].toFixed(2)} to ${observed}`);
  }
  return {
    label: baseline?.label ?? 'baseline',
    comparable: true,
    // The baselines are 3-task boards; a comparison of raw counts against an
    // 18-task run is not meaningful, and saying so is more useful than a ratio
    // that looks like a measurement.
    caveat:
      'the recorded baselines are 3-task boards at N=1 and N=2. Rates are comparable; ' +
      'raw counts are not.',
    delta,
    notes,
  };
}
