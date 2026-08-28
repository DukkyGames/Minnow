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

export { attemptCount, deadEnded, derive, lastEndedAttempt, readyTasks } from './derive.js';
