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
