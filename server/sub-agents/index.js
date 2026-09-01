/**
 * Sub-agent graph barrel (P8-C / MIN-756).
 *
 * Rules for the *graph* modules in this directory: no I/O, no clock, no
 * randomness, no imports outside this folder, and no model call. See README.md.
 * Enforced by `test/sub-agents/core-purity.test.mjs`.
 *
 * I/O siblings (config / journal / prompts / effector-runner / delivery) are
 * P8-D / P8-E and are not re-exported here, so importing the graph cannot
 * pull the runner or the parent-chat inject.
 */

export const GRAPH_VERSION = 1;

export {
  ATTEMPT_OUTCOMES,
  ENVELOPE_VERSION,
  EVENT_SCHEMAS,
  EVENT_TYPES,
  SUB_AGENT_ROLE,
  isKnownEventType,
  makeEvent,
  validateEvent,
} from './events.js';

export {
  AGENTS_NAMESPACE,
  DEFAULT_GLOBAL_MAX_CONCURRENT,
  DEFAULT_TYPE_MAX_CONCURRENT,
  attemptCount,
  derive,
  emptyState,
  foldInto,
  isTerminal,
  isStoppedForScheduling,
  lastEndedAttempt,
  pendingDeliveries,
  serializeState,
  stateToJSON,
} from './derive.js';

export {
  attemptHistoryRecord,
  bundleAbandonmentEvidence,
} from './evidence.js';

export {
  decide,
  formatPolicyTable,
  POLICY_TABLE,
} from './policy.js';

export {
  defaultCaps,
  nextAction,
  pendingAbandonments,
  plan,
  typeCap,
} from './plan.js';

export {
  createSubAgentGraph,
  eventsForAttemptEnd,
  eventsForStart,
  impliedEvents,
  isAlreadyEnded,
  isSubAgentRole,
  reapVanished,
  subAgentGraph,
} from './graph.js';
