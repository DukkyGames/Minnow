/**
 * P8-H helpers — fake-host scenarios, wait, and reliability accounting.
 *
 * Sub-agent journals use `attempt.started` / `attempt.ended` / `run.abandoned`,
 * not the board `task.attempt.*` names. Token cost and the duration tail are
 * therefore local copies of the P5-D observers, keyed on this vocabulary.
 * Sharing p5d-instrument.js would silently report zeros.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { reportOutcomeChunks } from '../../scripts/fake-model-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const P8H_RELIABILITY_PATH = path.join(HERE, 'p8h-reliability.json');

/** Deterministic usage so wasted-vs-total is a real figure, not "unreported". */
export const FAKE_USAGE = {
  prompt_tokens: 11,
  completion_tokens: 7,
  total_tokens: 18,
};

export const PASS_REPORT = {
  outcome: 'pass',
  summary: 'Explored the sandbox.',
  evidence: ['src/a.ts'],
  blockers: [],
  needs: [],
};

export const FAIL_REPORT = {
  outcome: 'fail',
  summary: 'Could not finish the scan.',
  evidence: [],
  blockers: ['missing entrypoint'],
  needs: [],
};

/**
 * Stick `usage` on the stream so TurnResult.usage lands on `attempt.ended`.
 * A usage-less fake host would make the reliability file's cost look complete
 * when it is actually unreported (P5-D's `attemptsWithoutUsage` flag).
 *
 * @param {string[]} chunks
 * @param {typeof FAKE_USAGE} [usage]
 * @returns {string[]}
 */
export function withUsage(chunks, usage = FAKE_USAGE) {
  const last = chunks[chunks.length - 1] ?? '';
  return [...chunks.slice(0, -1), `data: ${JSON.stringify({ usage })}\n\n`, last];
}

/**
 * Catch-all pass. No role/taskId match — sub-agent seeds are not V2 Builder
 * prompts, so extractRequestContext leaves those fields empty. A catch-all
 * is also what two concurrent runs need: they share one `*:*` nth counter.
 *
 * @returns {Array<{ match: object, emit: string[] }>}
 */
export function happyScenario() {
  return [{ match: {}, emit: withUsage(reportOutcomeChunks(PASS_REPORT, 'call_p8h_pass')) }];
}

/**
 * Every completion is `fail`. Three of these abandon (policy `under: 2`).
 *
 * @returns {Array<{ match: object, emit: string[] }>}
 */
export function failForeverScenario() {
  return [{ match: {}, emit: withUsage(reportOutcomeChunks(FAIL_REPORT, 'call_p8h_fail')) }];
}

/**
 * @param {() => unknown | Promise<unknown>} predicate
 * @param {number} [timeoutMs]
 * @param {string} [label]
 */
export async function waitFor(predicate, timeoutMs = 30_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Count retries (non-initial seeds) and abandonments from a sub-agent journal.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function reliabilityFromEvents(events) {
  const retries = events.filter(
    (event) =>
      event.type === 'attempt.started' &&
      typeof event.seedKind === 'string' &&
      event.seedKind !== 'initial',
  ).length;
  const abandonments = events.filter((event) => event.type === 'run.abandoned').length;
  const delivered = events.filter(
    (event) => event.type === 'result.delivered' && !event.skipReason,
  ).length;
  const passed = events.filter(
    (event) => event.type === 'attempt.ended' && event.outcome === 'pass',
  ).length;
  return { retries, abandonments, delivered, passed };
}

/** Nearest-rank percentile. A 3-sample p90 is a real sample, not an interpolation. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * Attempt wall-clock tail. The mean is useless here — one forty-second
 * retry is the reliability risk, and it disappears into an average.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function attemptDurationTail(events) {
  /** @type {Map<string, number>} */
  const open = new Map();
  /** @type {number[]} */
  const finishedMs = [];
  let stillOpen = 0;

  for (const event of events) {
    const ts = Number(event?.ts);
    const attemptId = String(event?.attemptId ?? '');
    if (!attemptId || !Number.isFinite(ts)) continue;
    if (event.type === 'attempt.started') {
      open.set(attemptId, ts);
    } else if (event.type === 'attempt.ended') {
      const startedAt = open.get(attemptId);
      open.delete(attemptId);
      if (startedAt != null) finishedMs.push(Math.max(0, ts - startedAt));
    }
  }
  stillOpen = open.size;
  const sorted = [...finishedMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    open: stillOpen,
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

/**
 * Token cost including attempts that produced nothing (`crashed` / `timeout` /
 * `no_report`). Failures that did report are not "wasted" — they are a verdict.
 *
 * @param {Array<Record<string, unknown>>} events
 */
export function tokenCostFromEvents(events) {
  const total = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const wasted = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let attemptsWithUsage = 0;
  let attemptsWithoutUsage = 0;
  const NO_PRODUCT = new Set(['crashed', 'timeout', 'no_report']);

  for (const event of events) {
    if (event?.type !== 'attempt.ended') continue;
    const usage = event.usage;
    if (!usage || typeof usage !== 'object') {
      attemptsWithoutUsage += 1;
      continue;
    }
    attemptsWithUsage += 1;
    for (const key of Object.keys(total)) {
      const value = Number(usage[key]);
      if (Number.isFinite(value)) total[key] += value;
    }
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
    attemptsWithUsage,
    attemptsWithoutUsage,
    complete: attemptsWithoutUsage === 0 && attemptsWithUsage > 0,
  };
}

/**
 * Probe a live OpenAI-compatible host. A miss is recorded, never faked.
 *
 * @param {string} [baseUrl]
 * @returns {Promise<{ skipped: true, reason: string } | { skipped: false, baseUrl: string }>}
 */
export async function probeRealProvider(baseUrl = 'http://127.0.0.1:1234') {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return {
        skipped: true,
        reason: `provider at ${baseUrl} returned HTTP ${response.status}; not a live-LLM result`,
      };
    }
    return { skipped: false, baseUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skipped: true,
      reason: `no live LM Studio/provider reachable from this worktree (${message})`,
    };
  }
}

/**
 * Hold-gate so two starts overlap in `inspect()` instead of racing to finish.
 * Copied from P3-E: the cap proof is against the live effector, not wall-clock.
 *
 * @returns {{ closed: boolean, wait: (signal?: AbortSignal) => Promise<void>, release: () => void }}
 */
export function createHoldGate() {
  let closed = true;
  /** @type {Array<() => void>} */
  const waiters = [];
  return {
    get closed() {
      return closed;
    },
    /** @param {AbortSignal | undefined} signal */
    wait(signal) {
      if (!closed) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
        waiters.push(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        });
      });
    },
    release() {
      closed = false;
      for (const done of waiters) done();
      waiters.length = 0;
    },
  };
}
