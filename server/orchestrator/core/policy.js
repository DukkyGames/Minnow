/**
 * P0-E — the policy table. One place that decides what happens next.
 *
 * V1 spread recovery policy across six call sites and six counters — mutated in
 * self-heal, in stream-end finalize, in both `apply*FailureState` helpers, and in
 * both fixers. Nothing in V1 could answer "what happens to this task next?".
 * This table is that answer.
 *
 * ```
 * | role    | outcome            | attempts | action                                   |
 * | ------- | ------------------ | -------- | ---------------------------------------- |
 * | builder | pass               | —        | advance → tester                         |
 * | builder | fail               | < 2      | retry builder, failure-aware seed         |
 * | builder | fail               | >= 2     | abandon                                  |
 * | builder | blocked            | < 1      | retry builder, repair seed (same worktree)|
 * | builder | blocked            | >= 1     | abandon                                  |
 * | builder | no_report          | < 1      | retry builder, continue seed              |
 * | builder | crashed or timeout | < 2      | retry builder, continue seed              |
 * | tester  | pass               | —        | advance → merge queue                    |
 * | tester  | fail               | < 2      | retry builder, fix seed carrying test out |
 * | tester  | fail               | >= 2     | abandon                                  |
 * | merge   | conflicted         | < 2      | retry builder, rebase seed                |
 * | merge   | conflicted         | >= 2     | abandon                                  |
 * ```
 *
 * ## What the `attempts` column counts
 *
 * **Attempts of this role that had already finished *before* the one being
 * decided** — how many times we have tried this already, not counting now.
 *
 * The alternative reading, where the just-ended attempt is included, makes the
 * `blocked | < 1` and `no_report | < 1` rows unreachable: an attempt cannot end
 * as `blocked` with zero attempts finished. That would silently delete the
 * repair path, which is the entire replacement for the env-fixer. It would also
 * flatten the table, since every remaining row would allow exactly one retry.
 *
 * Under the reading used here the table says what it looks like it says: `fail`,
 * `crashed`, and `timeout` are worth two more tries; `blocked` and `no_report`
 * are worth one.
 *
 * `nextAction()` in `plan.js` is where the conversion happens, and it is the only
 * caller.
 *
 * ## Two agent kinds this deletes
 *
 * **The env-fixer is gone.** `blocked` retries the *builder* with a repair seed
 * in its own worktree — which is whose worktree it is. That removes an agent kind
 * and the entire env-fixer finalize/hold/leak path behind V1's confirmed
 * sequential deadlock.
 *
 * **The merge-fixer is gone.** A conflict re-opens the owning task with a rebase
 * seed; the agent that wrote the code has the context to resolve a conflict in it.
 *
 * ## What is deliberately absent
 *
 * No LLM advisor at the `abandon` boundary. It was proposed during design and
 * rejected (PRD §11): it would be the only nondeterministic element in the control
 * plane, forfeiting the replay property everything else depends on; its safe move
 * duplicates the failure-aware retry the Builder already gets; its powerful moves
 * mutate the DAG mid-run precisely when a run is going badly; and there is no data
 * that `abandon` is ever the wrong call.
 *
 * ## The single call site
 *
 * `decide()` is called from exactly one place: `nextAction()` in `plan.js`. Both
 * the scheduler (what to start) and the engine (what to journal as abandoned) go
 * through that one function, so the table cannot be applied inconsistently and
 * replay cannot diverge from live.
 */

/**
 * Every retry targets the builder. There is exactly one forward edge in this
 * table (`builder → tester`) and exactly one backward target (`builder`).
 */
const RETRY_ROLE = 'builder';

/**
 * @typedef {'pass' | 'fail' | 'blocked' | 'no_report' | 'crashed' | 'timeout' | 'conflicted'} PolicyOutcome
 */

/**
 * @param {string} seedKind
 * @param {boolean} [sameWorktree]
 * @returns {{ kind: 'retry', role: 'builder', seedKind: string, sameWorktree: boolean }}
 */
const retry = (seedKind, sameWorktree = false) => ({
  kind: 'retry',
  role: RETRY_ROLE,
  seedKind,
  sameWorktree,
});

/**
 * @param {'tester' | 'merge' | 'done'} to
 * @returns {{ kind: 'advance', to: 'tester' | 'merge' | 'done' }}
 */
const advance = (to) => ({ kind: 'advance', to });

/**
 * @param {string} reason
 * @returns {{ kind: 'abandon', reason: string }}
 */
const abandon = (reason) => ({ kind: 'abandon', reason });

/**
 * The table, as data. Rows are matched top to bottom; the first whose role,
 * outcome, and attempt bound all match wins.
 *
 * `under: n` means "applies while `attemptCount < n`". `under: null` means the
 * bound does not apply, so the row is the fallback for that role and outcome —
 * which is why every bounded row is immediately followed by its unbounded twin.
 *
 * `'*'` matches any role or outcome. The last row exists so `decide()` is total
 * over inputs this table was never written for, rather than returning undefined.
 */
export const POLICY_TABLE = /** @type {const} */ ([
  // --- builder ------------------------------------------------------------
  { role: 'builder', outcome: 'pass', under: null, action: advance('tester') },
  { role: 'builder', outcome: 'fail', under: 2, action: retry('failure-aware') },
  { role: 'builder', outcome: 'fail', under: null, action: abandon('builder-failed') },
  // `blocked` is the env-fixer's replacement: same agent, same worktree, repair seed.
  { role: 'builder', outcome: 'blocked', under: 1, action: retry('repair', true) },
  { role: 'builder', outcome: 'blocked', under: null, action: abandon('builder-blocked') },
  { role: 'builder', outcome: 'no_report', under: 1, action: retry('continue') },
  { role: 'builder', outcome: 'no_report', under: null, action: abandon('builder-no-report') },
  { role: 'builder', outcome: 'crashed', under: 2, action: retry('continue') },
  { role: 'builder', outcome: 'crashed', under: null, action: abandon('builder-crashed') },
  { role: 'builder', outcome: 'timeout', under: 2, action: retry('continue') },
  { role: 'builder', outcome: 'timeout', under: null, action: abandon('builder-timeout') },

  // --- tester -------------------------------------------------------------
  { role: 'tester', outcome: 'pass', under: null, action: advance('merge') },
  { role: 'tester', outcome: 'fail', under: 2, action: retry('fix') },
  { role: 'tester', outcome: 'fail', under: null, action: abandon('tester-failed') },
  { role: 'tester', outcome: 'blocked', under: 1, action: retry('repair', true) },
  { role: 'tester', outcome: 'blocked', under: null, action: abandon('tester-blocked') },
  // A tester that crashed or never reported did not disprove the build, so the
  // cheapest correct move is the same one the builder gets: continue and re-test.
  { role: 'tester', outcome: 'no_report', under: 1, action: retry('continue') },
  { role: 'tester', outcome: 'no_report', under: null, action: abandon('tester-no-report') },
  { role: 'tester', outcome: 'crashed', under: 2, action: retry('continue') },
  { role: 'tester', outcome: 'crashed', under: null, action: abandon('tester-crashed') },
  { role: 'tester', outcome: 'timeout', under: 2, action: retry('continue') },
  { role: 'tester', outcome: 'timeout', under: null, action: abandon('tester-timeout') },

  // --- merge --------------------------------------------------------------
  { role: 'merge', outcome: 'pass', under: null, action: advance('done') },
  { role: 'merge', outcome: 'conflicted', under: 2, action: retry('rebase') },
  { role: 'merge', outcome: 'conflicted', under: null, action: abandon('merge-conflicted') },
  // Any other way a merge can end is mechanical and rebase is still the answer.
  { role: 'merge', outcome: '*', under: 2, action: retry('rebase') },
  { role: 'merge', outcome: '*', under: null, action: abandon('merge-failed') },

  // --- final --------------------------------------------------------------
  { role: 'final', outcome: 'pass', under: null, action: advance('done') },
  { role: 'final', outcome: '*', under: null, action: abandon('final-test-failed') },

  // --- total over everything else ----------------------------------------
  { role: '*', outcome: '*', under: null, action: abandon('unhandled-outcome') },
]);

/**
 * What happens next.
 *
 * @param {{
 *   role: string,
 *   outcome: string,
 *   attemptCount: number,
 *     Attempts of this role finished *before* the one being decided. See the
 *     module header — the other reading makes the repair path unreachable.
 *   summary?: string | null,
 *   evidence?: Record<string, unknown> | null,
 * }} input
 * @returns {import('./types').Action}
 */
export function decide(input) {
  const { role, outcome } = input;
  const attemptCount = Number.isFinite(input.attemptCount) ? Number(input.attemptCount) : 0;

  const row = POLICY_TABLE.find(
    (r) =>
      (r.role === '*' || r.role === role) &&
      (r.outcome === '*' || r.outcome === outcome) &&
      (r.under === null || attemptCount < r.under),
  );

  // Unreachable: the last row matches everything. Kept so a future edit that
  // reorders the table fails loudly in tests rather than returning undefined.
  if (!row) return { kind: 'abandon', reason: 'unhandled-outcome', evidence: evidenceFor(input) };

  if (row.action.kind !== 'abandon') return { ...row.action };
  return { ...row.action, evidence: evidenceFor(input) };
}

/**
 * The evidence an abandonment carries.
 *
 * PRD §11 keeps open the option of retroactively measuring how many
 * abandonments a smarter policy would have saved. That is only possible if the
 * inputs to the decision are captured at the moment it is made.
 *
 * @param {{ role: string, outcome: string, attemptCount: number, summary?: string | null,
 *           evidence?: Record<string, unknown> | null }} input
 * @returns {Record<string, unknown>}
 */
function evidenceFor(input) {
  /** @type {Record<string, unknown>} */
  const evidence = {
    role: input.role,
    outcome: input.outcome,
    attemptCount: Number.isFinite(input.attemptCount) ? Number(input.attemptCount) : 0,
  };
  if (input.summary != null) evidence.summary = input.summary;
  if (input.evidence != null) evidence.detail = input.evidence;
  return evidence;
}

/**
 * Does this seed kind repair in place rather than in a fresh worktree?
 *
 * Derived from the seed rather than carried alongside it, so a resumed attempt
 * and a freshly decided one cannot disagree — the journal records `seedKind` on
 * `task.attempt.started`, and this is the whole of what that implies.
 *
 * @param {string | null | undefined} seedKind
 * @returns {boolean}
 */
export function wantsSameWorktree(seedKind) {
  return seedKind === 'repair';
}

/**
 * Render the table as markdown, so a test can compare it to the documented one
 * cell for cell rather than restating it.
 *
 * @returns {string}
 */
export function formatPolicyTable() {
  const lines = ['| role | outcome | attempts | action |', '| --- | --- | --- | --- |'];
  for (const row of POLICY_TABLE) {
    const attempts = row.under === null ? '—' : `< ${row.under}`;
    lines.push(`| ${row.role} | ${row.outcome} | ${attempts} | ${describeAction(row.action)} |`);
  }
  return lines.join('\n');
}

/**
 * @param {{ kind: string, [k: string]: unknown }} action
 * @returns {string}
 */
function describeAction(action) {
  if (action.kind === 'advance') return `advance → ${action.to}`;
  if (action.kind === 'retry') {
    return `retry ${action.role}, ${action.seedKind} seed${action.sameWorktree ? ' (same worktree)' : ''}`;
  }
  return `abandon (${action.reason})`;
}
