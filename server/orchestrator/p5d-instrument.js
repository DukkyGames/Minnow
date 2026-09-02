/** Instrumentation for unattended overnight runs. */

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
    complete: attemptsWithoutUsage === 0 && attemptsWithUsage > 0,
  };
}

/**
 * Did the run report exactly once?
 * @param {Array<Record<string, unknown>>} events
 */
export function reportCount(events) {
  const reports = events.filter((event) => event?.type === REPORT_EVENT_TYPE);
  const finishes = events.filter((event) => event?.type === 'run.finished');
  return {
    reports: reports.length,
    finishes: finishes.length,
    exactlyOnce: reports.length === 1,
    finishedWithoutReporting: finishes.length > 0 && reports.length === 0,
  };
}

/**
 * Live counts the journal cannot know: this process's memory, and the browser and worktree processes still on the machine.
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
 * Worktrees still on disk for a board, and whether the journal thinks any attempt is still using them.
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
 * Compare a run against the recorded (N=1) and (N=2) baselines.
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
    caveat:
      'the recorded baselines are 3-task boards at N=1 and N=2. Rates are comparable; ' +
      'raw counts are not.',
    delta,
    notes,
  };
}
