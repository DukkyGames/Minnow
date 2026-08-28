/** Journal envelope version this build writes. */
export const CORE_VERSION: number;

export type {
  Role,
  AgentRole,
  AttemptResult,
  SeedKind,
  TaskPhase,
  BoardStatus,
  StopReason,
  EventEnvelope,
  JournalEvent,
  JournalEventType,
  ValidationResult,
  PlanTask,
  TaskGraph,
  ParseError,
  Attempt,
  TaskState,
  BoardState,
  Desired,
  Action,
  Snapshot,
} from './types';

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
} from './events';

export { attemptCount, deadEnded, derive, lastEndedAttempt, readyTasks } from './derive';
export type { Attempt, TouchesOverflow, FinalTestState, WaveRef, Evidence } from './types';

export { decide, formatPolicyTable, POLICY_TABLE } from './policy';
export type { PolicyOutcome, PolicyRow, RetryAction, AdvanceAction, AbandonAction } from './types';

export {
  globsIntersect,
  nextAction,
  orderedTaskIds,
  pendingAbandonments,
  pendingEnqueues,
  plan,
  touchesOverlap,
} from './plan';
export type { NextAction } from './types';

export { formatParseErrors, isParseErrors, parsePlan } from './parse-plan';

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
} from './snapshot';
export { emptyState, foldInto } from './derive';
