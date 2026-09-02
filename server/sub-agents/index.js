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
