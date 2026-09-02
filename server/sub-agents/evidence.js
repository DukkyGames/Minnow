/**
 * @param {import('./types').Attempt} attempt
 * @returns {Record<string, unknown>}
 */
export function attemptHistoryRecord(attempt) {
  /** @type {Record<string, unknown>} */
  const record = {
    attemptId: attempt.attemptId ?? null,
    seedKind: attempt.seedKind ?? null,
    ended: Boolean(attempt.ended),
    outcome: attempt.outcome ?? null,
  };
  if (attempt.summary != null) record.summary = attempt.summary;
  if (attempt.seed != null) record.seed = attempt.seed;
  if (attempt.model != null) record.model = attempt.model;
  if (attempt.usage != null) record.usage = attempt.usage;
  if (attempt.evidence != null) record.detail = attempt.evidence;
  return record;
}

/**
 * Evidence journaled on `run.abandoned`.
 *
 * @param {import('./types').RunState} run
 * @param {{ evidence?: Record<string, unknown> | null }} decision
 * @returns {Record<string, unknown>}
 */
export function bundleAbandonmentEvidence(run, decision) {
  const base =
    decision.evidence && typeof decision.evidence === 'object' ? { ...decision.evidence } : {};
  const attempts = Array.isArray(run?.attempts)
    ? run.attempts.map((a) => attemptHistoryRecord(a))
    : [];
  const tail = lastTranscriptTail(run);
  /** @type {Record<string, unknown>} */
  const bundle = { ...base, attempts };
  if (tail != null) bundle.transcriptTail = tail;
  return bundle;
}

/**
 * @param {import('./types').RunState | null | undefined} run
 * @returns {string | null}
 */
function lastTranscriptTail(run) {
  if (!run) return null;
  for (let i = (run.attempts?.length ?? 0) - 1; i >= 0; i -= 1) {
    const ev = run.attempts[i]?.evidence;
    if (!ev || typeof ev !== 'object') continue;
    if (typeof ev.transcriptTail === 'string') return ev.transcriptTail;
    if (typeof ev.transcript === 'string') return ev.transcript;
  }
  return null;
}
