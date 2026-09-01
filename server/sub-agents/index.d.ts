export const GRAPH_VERSION: number;

export type {
  Action,
  AgentsState,
  AgentsStatus,
  Attempt,
  AttemptOutcome,
  Caps,
  Desired,
  EventEnvelope,
  NextAction,
  PolicyRow,
  RunPhase,
  RunState,
  SeedKind,
  SubAgentRole,
  ValidationResult,
} from './types';

export {
  ATTEMPT_OUTCOMES,
  ENVELOPE_VERSION,
  EVENT_SCHEMAS,
  EVENT_TYPES,
  SUB_AGENT_ROLE,
  isKnownEventType,
  makeEvent,
  validateEvent,
} from './events';

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
} from './derive';

export { attemptHistoryRecord, bundleAbandonmentEvidence } from './evidence';

export { decide, formatPolicyTable, POLICY_TABLE } from './policy';

export { defaultCaps, nextAction, pendingAbandonments, plan, typeCap } from './plan';

export {
  createSubAgentGraph,
  eventsForAttemptEnd,
  eventsForStart,
  impliedEvents,
  isAlreadyEnded,
  isSubAgentRole,
  reapVanished,
  subAgentGraph,
} from './graph';
