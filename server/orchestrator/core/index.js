/**
 * Orchestrator V2 — pure decision core (barrel).
 *
 * Rules for everything in this directory: no I/O, no clock, no randomness, no
 * imports outside `core/`, and no model call. See README.md. Enforced by
 * `test/orchestrator/core-purity.test.mjs`.
 *
 * Authored as plain `.js` + a hand-written `.d.ts` companion because the server
 * ships untranspiled (`npm start` → `node server.js`). Same pattern as
 * `server/tools/output-cap.js`.
 */

/**
 * Journal envelope version this build writes.
 *
 * Readers must tolerate a higher version rather than throw — the fold is
 * required to survive schema churn (PRD §12).
 */
export const CORE_VERSION = 1;

export {
  ATTEMPT_OUTCOMES,
  ENVELOPE_VERSION,
  EVENT_SCHEMAS,
  EVENT_TYPES,
  isKnownEventType,
  makeEvent,
  ROLES,
  STOP_REASONS,
  validateEvent,
} from './events.js';

export {
  attemptCount,
  deadEnded,
  DEFAULT_BOARD_CONCURRENCY,
  derive,
  emptyState,
  foldInto,
  lastEndedAttempt,
  readyTasks,
} from './derive.js';

export {
  abandonmentEvidenceIsComplete,
  attemptHistoryRecord,
  bundleAbandonmentEvidence,
  capDiffPayload,
  capDiffText,
  MAX_DIFF_CHARS,
  queryAbandonments,
} from './evidence.js';

export {
  decide,
  formatPolicyTable,
  POLICY_TABLE,
  SAME_WORKTREE_SEED_KINDS,
  wantsSameWorktree,
} from './policy.js';

export {
  expandTouches,
  expandedFilesOverlap,
  footprintsClash,
  globsIntersect,
  isReadyForFinalTest,
  manualStart,
  nextAction,
  normalizeRepoPath,
  orderedTaskIds,
  overflowPaths,
  pathMatchesGlob,
  pendingAbandonments,
  pendingEnqueues,
  pendingSkips,
  plan,
  reopenTargets,
  buildIntegrationFixTask,
  touchesOverlap,
} from './plan.js';

export { summarizeTouchesOverflow } from './overflow-report.js';

export { formatParseErrors, isParseErrors, parsePlan } from './parse-plan.js';

export {
  canonicalise,
  decanonicalise,
  deriveFrom,
  hashSnapshot,
  hashState,
  isSnapshotUsable,
  makeSnapshot,
  SNAPSHOT_INTERVAL,
  SNAPSHOT_VERSION,
  shouldSnapshot,
  stateFromJSON,
  stateToJSON,
} from './snapshot.js';
