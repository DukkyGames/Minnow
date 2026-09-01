/**
 * P8-C — the sub-agent policy table. One place that decides what happens next.
 *
 * ```
 * | outcome            | attempts | action                                      |
 * | ------------------ | -------- | ------------------------------------------- |
 * | pass               | —        | deliver (P8-E journals result.delivered)    |
 * | fail               | < 2      | retry, continue seed                        |
 * | fail               | —        | abandon with full evidence                  |
 * | blocked            | < 1      | retry, continue seed                        |
 * | blocked            | —        | abandon                                     |
 * | no_report          | < 1      | retry, continue seed                        |
 * | no_report          | —        | abandon                                     |
 * | crashed or timeout | < 2      | retry, continue seed                        |
 * | crashed or timeout | —        | abandon                                     |
 * | cancel             | —        | done (terminal, not a failure)              |
 * ```
 *
 * `crashed` / `timeout` / `no_report` retry with a continue seed so the next
 * attempt sees the transcript rather than starting cold. Unbounded retry would
 * stall a generated crashed-forever history and an overnight run; the bounds
 * above are data in the table, not a counter field on the run.
 *
 * `decide()` is last-attempt-only. The caller attaches the evidence bundle —
 * the same split as P0-E / P3-H.
 *
 * Cancel is a journaled `run.cancelled`, not an attempt outcome. The row exists
 * so a caller that asks anyway gets "done", never a retry or a failure reason.
 */

const retry = () => /** @type {const} */ ({ kind: 'retry', seedKind: 'continue' });

/**
 * @param {string} reason
 * @returns {{ kind: 'abandon', reason: string }}
 */
const abandon = (reason) => ({ kind: 'abandon', reason });

/**
 * The table, as data. Rows are matched top to bottom; the first whose outcome
 * and attempt bound match wins. `under: n` means `attemptCount < n`.
 * `under: null` is that outcome's fallback.
 *
 * There is no `role` column: this graph has one worker role (`sub-agent`).
 */
export const POLICY_TABLE = /** @type {const} */ ([
  { outcome: 'pass', under: null, action: { kind: 'deliver' } },
  { outcome: 'fail', under: 2, action: retry() },
  { outcome: 'fail', under: null, action: abandon('failed') },
  { outcome: 'blocked', under: 1, action: retry() },
  { outcome: 'blocked', under: null, action: abandon('blocked') },
  { outcome: 'no_report', under: 1, action: retry() },
  { outcome: 'no_report', under: null, action: abandon('no-report') },
  { outcome: 'crashed', under: 2, action: retry() },
  { outcome: 'crashed', under: null, action: abandon('crashed') },
  { outcome: 'timeout', under: 2, action: retry() },
  { outcome: 'timeout', under: null, action: abandon('timeout') },
  { outcome: 'cancel', under: null, action: { kind: 'done', reason: 'user' } },
  { outcome: '*', under: null, action: abandon('unhandled-outcome') },
]);

/**
 * What happens next.
 *
 * @param {{
 *   outcome: string,
 *   attemptCount: number,
 *     Attempts that had already finished *before* the one being decided.
 *     Counting the just-ended attempt would make the `under: 1` rows
 *     unreachable — the same reading P0-E documents.
 *   summary?: string | null,
 *   evidence?: Record<string, unknown> | null,
 * }} input
 * @returns {import('./types').Action}
 */
export function decide(input) {
  const outcome = input?.outcome;
  const attemptCount = Number.isFinite(input?.attemptCount) ? Number(input.attemptCount) : 0;

  const row = POLICY_TABLE.find(
    (r) =>
      (r.outcome === '*' || r.outcome === outcome) &&
      (r.under === null || attemptCount < r.under),
  );

  if (!row) return { kind: 'abandon', reason: 'unhandled-outcome', evidence: evidenceFor(input) };

  if (row.action.kind !== 'abandon') return { ...row.action };
  return { ...row.action, evidence: evidenceFor(input) };
}

/**
 * Last-attempt inputs only. Full history is attached by `bundleAbandonmentEvidence`.
 *
 * @param {{ outcome?: string, attemptCount?: number, summary?: string | null,
 *           evidence?: Record<string, unknown> | null }} input
 * @returns {Record<string, unknown>}
 */
function evidenceFor(input) {
  /** @type {Record<string, unknown>} */
  const evidence = {
    outcome: input?.outcome ?? null,
    attemptCount: Number.isFinite(input?.attemptCount) ? Number(input.attemptCount) : 0,
  };
  if (input?.summary != null) evidence.summary = input.summary;
  if (input?.evidence != null) evidence.detail = input.evidence;
  return evidence;
}

/**
 * Render the table as markdown so a test can compare it cell for cell.
 *
 * @returns {string}
 */
export function formatPolicyTable() {
  const lines = ['| outcome | attempts | action |', '| --- | --- | --- |'];
  for (const row of POLICY_TABLE) {
    const attempts = row.under === null ? '—' : `< ${row.under}`;
    lines.push(`| ${row.outcome} | ${attempts} | ${describeAction(row.action)} |`);
  }
  return lines.join('\n');
}

/**
 * @param {{ kind: string, [k: string]: unknown }} action
 * @returns {string}
 */
function describeAction(action) {
  if (action.kind === 'deliver') return 'deliver (result.delivered)';
  if (action.kind === 'retry') return `retry, ${action.seedKind} seed`;
  if (action.kind === 'done') return `done (${action.reason})`;
  return `abandon (${action.reason})`;
}
