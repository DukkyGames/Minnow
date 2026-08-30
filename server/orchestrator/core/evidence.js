/**
 * P3-H — abandonment evidence (PRD §11).
 *
 * The control plane never asks an LLM whether to abandon. What it *does* is
 * journal enough context that a later measurement can ask, from the journal
 * alone, whether a smarter policy would have saved the task.
 *
 * This module is pure: it shapes records and reconstructs them from events.
 * Git diffs are captured in `touches.js` (I/O) and arrive already attached to
 * an attempt's `evidence.diff`.
 */

/** A unified diff, not a repo. Patch text longer than this is truncated. */
export const MAX_DIFF_CHARS = 32_768;

/**
 * Cap a patch string. Attempt *history* is never truncated; only the bytes of
 * one diff are, so an overnight run cannot journal a whole checkout.
 *
 * @param {unknown} text
 * @returns {{ text: string, truncated: boolean, originalLength?: number }}
 */
export function capDiffText(text) {
  const value = text == null ? '' : String(text);
  if (value.length <= MAX_DIFF_CHARS) return { text: value, truncated: false };
  return { text: value.slice(0, MAX_DIFF_CHARS), truncated: true, originalLength: value.length };
}

/**
 * Normalise a captured worktree diff so replay and live agree on shape.
 *
 * @param {unknown} diff
 * @returns {Record<string, unknown> | string | null}
 */
export function capDiffPayload(diff) {
  if (diff == null) return null;
  if (typeof diff === 'string') {
    const capped = capDiffText(diff);
    if (!capped.text && !capped.truncated) return null;
    /** @type {Record<string, unknown>} */
    const out = { patch: capped.text, truncated: capped.truncated };
    if (capped.originalLength != null) out.originalLength = capped.originalLength;
    return out;
  }
  if (typeof diff !== 'object') return null;
  const rec = /** @type {Record<string, unknown>} */ (diff);
  /** @type {Record<string, unknown>} */
  const out = {};
  if (Array.isArray(rec.files)) out.files = rec.files.map(String);
  const patch = rec.patch != null ? rec.patch : rec.text;
  if (patch != null) {
    const capped = capDiffText(patch);
    out.patch = capped.text;
    out.truncated = Boolean(rec.truncated) || capped.truncated;
    if (capped.originalLength != null) out.originalLength = capped.originalLength;
    else if (typeof rec.originalLength === 'number') out.originalLength = rec.originalLength;
  } else if (rec.truncated) {
    out.truncated = true;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * One finished (or still-open) attempt, flattened for the abandonment bundle.
 *
 * @param {import('./types').Attempt | Record<string, unknown>} attempt
 * @returns {Record<string, unknown>}
 */
export function attemptHistoryRecord(attempt) {
  const ev =
    attempt.evidence && typeof attempt.evidence === 'object' && !Array.isArray(attempt.evidence)
      ? /** @type {Record<string, unknown>} */ (attempt.evidence)
      : {};
  /** @type {Record<string, unknown>} */
  const record = {
    attemptId: attempt.attemptId ?? null,
    role: attempt.role ?? null,
    seedKind: attempt.seedKind ?? null,
    ended: Boolean(attempt.ended),
    outcome: attempt.outcome ?? null,
  };
  if (attempt.summary != null) record.summary = attempt.summary;
  if (attempt.worktree != null) record.worktree = attempt.worktree;

  if (ev.testOutput != null) record.testOutput = ev.testOutput;
  if (Array.isArray(ev.needs)) record.needs = ev.needs;
  if (Array.isArray(ev.blockers)) record.blockers = ev.blockers;
  const diff = capDiffPayload(ev.diff);
  if (diff) record.diff = diff;

  // Leftover attempt evidence (error strings, report lists) stays attached so
  // a later reader does not have to know which keys we promoted.
  /** @type {Record<string, unknown>} */
  const rest = {};
  for (const [key, value] of Object.entries(ev)) {
    if (key === 'testOutput' || key === 'needs' || key === 'blockers' || key === 'diff') continue;
    rest[key] = value;
  }
  if (Object.keys(rest).length > 0) record.detail = rest;
  return record;
}

/**
 * Evidence journaled on `task.abandoned`.
 *
 * The policy table's last-attempt inputs stay on the object (`role`, `outcome`,
 * `attemptCount`) so existing readers keep working. `attempts` is the full
 * history PRD §11 asked for — never truncated as a list.
 *
 * @param {import('./types').TaskState | { attempts?: readonly import('./types').Attempt[] }} task
 * @param {{ evidence?: Record<string, unknown> | null }} decision
 * @returns {Record<string, unknown>}
 */
export function bundleAbandonmentEvidence(task, decision) {
  const base =
    decision.evidence && typeof decision.evidence === 'object' ? { ...decision.evidence } : {};
  const attempts = Array.isArray(task?.attempts)
    ? task.attempts.map((a) => attemptHistoryRecord(a))
    : [];
  return { ...base, attempts };
}

/**
 * Does this bundle carry a non-empty attempt history and at least one
 * inspectable piece of evidence besides the empty object?
 *
 * @param {unknown} evidence
 * @returns {boolean}
 */
export function abandonmentEvidenceIsComplete(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  const rec = /** @type {Record<string, unknown>} */ (evidence);
  if (!Array.isArray(rec.attempts) || rec.attempts.length === 0) return false;
  if (rec.outcome != null && rec.outcome !== '') return true;
  if (rec.summary != null && rec.summary !== '') return true;
  if (rec.detail != null) return true;
  for (const attempt of rec.attempts) {
    if (!attempt || typeof attempt !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (attempt);
    if (row.outcome != null && row.outcome !== '') return true;
    if (row.summary != null && row.summary !== '') return true;
    if (row.testOutput != null && row.testOutput !== '') return true;
    if (Array.isArray(row.needs) && row.needs.length > 0) return true;
    if (Array.isArray(row.blockers) && row.blockers.length > 0) return true;
    if (row.diff != null) return true;
  }
  return false;
}

/**
 * Rebuild every abandonment from journal events alone.
 *
 * Prefers `task.abandoned.evidence.attempts` when present (live path). Falls
 * back to folding `task.attempt.started` / `task.attempt.ended` so a thin
 * pre-P3-H journal is still measurable.
 *
 * @param {Iterable<unknown>} events
 * @returns {Array<{ taskId: string, reason: unknown, evidence: Record<string, unknown> }>}
 */
export function queryAbandonments(events) {
  /** @type {Map<string, Record<string, unknown>>} */
  const open = new Map();
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const history = new Map();
  /** @type {Array<{ taskId: string, reason: unknown, evidence: Record<string, unknown> }>} */
  const out = [];

  for (const raw of events ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const event = /** @type {Record<string, unknown>} */ (raw);
    const type = event.type;

    if (type === 'task.attempt.started' && typeof event.taskId === 'string') {
      open.set(String(event.attemptId ?? ''), event);
      continue;
    }

    if (type === 'task.attempt.ended' && typeof event.taskId === 'string') {
      const start = open.get(String(event.attemptId ?? '')) ?? {};
      open.delete(String(event.attemptId ?? ''));
      const ev =
        event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence)
          ? /** @type {Record<string, unknown>} */ (event.evidence)
          : {};
      /** @type {Record<string, unknown>} */
      const record = {
        attemptId: event.attemptId ?? start.attemptId ?? null,
        role: event.role ?? start.role ?? null,
        seedKind: start.seedKind ?? null,
        ended: true,
        outcome: event.outcome ?? null,
      };
      if (event.summary != null) record.summary = event.summary;
      else if (start.summary != null) record.summary = start.summary;
      if (start.worktree != null) record.worktree = start.worktree;
      if (ev.testOutput != null) record.testOutput = ev.testOutput;
      if (Array.isArray(ev.needs)) record.needs = ev.needs;
      if (Array.isArray(ev.blockers)) record.blockers = ev.blockers;
      const diff = capDiffPayload(ev.diff);
      if (diff) record.diff = diff;
      const list = history.get(event.taskId) ?? [];
      list.push(record);
      history.set(event.taskId, list);
      continue;
    }

    if (type === 'task.abandoned' && typeof event.taskId === 'string') {
      const stored =
        event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence)
          ? { .../** @type {Record<string, unknown>} */ (event.evidence) }
          : {};
      const reconstructed = history.get(event.taskId) ?? [];
      const storedAttempts = stored.attempts;
      const attempts =
        Array.isArray(storedAttempts) && storedAttempts.length > 0 ? storedAttempts : reconstructed;
      out.push({
        taskId: event.taskId,
        reason: event.reason,
        evidence: { ...stored, attempts },
      });
    }
  }

  return out;
}
