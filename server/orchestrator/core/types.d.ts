/**
 * Shared shapes for the Orchestrator V2 pure core.
 *
 * This file is the single home for the core's type vocabulary. Each module's
 * `.d.ts` companion imports from here rather than redeclaring, so there is one
 * definition of `BoardState` and one of `JournalEvent`.
 *
 * P0-A declares the skeleton; P0-B–P0-F fill in the members.
 */

// ---------------------------------------------------------------------------
// Roles, outcomes, seeds
// ---------------------------------------------------------------------------

/** Who is attempting the work. `merge` and `final` are engine-driven, not agents. */
export type Role = 'builder' | 'tester' | 'merge' | 'final';

/** The subset of roles an LLM agent actually performs. */
export type AgentRole = 'builder' | 'tester';

/**
 * How an attempt ended. The six-way union.
 *
 * `pass` / `fail` / `blocked` are reported *by the agent* through its report tool.
 * `no_report` / `crashed` / `timeout` are produced *by the runner* when the agent
 * did not report one of the first three.
 */
export type AttemptResult =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'no_report'
  | 'crashed'
  | 'timeout';

/** Which prompt shape a retry gets. P2-E turns these into actual prompts. */
export type SeedKind =
  | 'initial'
  | 'failure-aware'
  | 'repair'
  | 'continue'
  | 'fix'
  | 'rebase';

/** Derived task phase. Never stored — always computed by `derive()`. */
export type TaskPhase =
  | 'idle'
  | 'building'
  | 'testing'
  | 'merging'
  | 'merged'
  | 'abandoned'
  | 'skipped';

/** Board run status. */
export type BoardStatus = 'created' | 'running' | 'stopped';

/** Why a board stopped. */
export type StopReason = 'user' | 'complete' | 'terminal';

// ---------------------------------------------------------------------------
// Journal events — populated by P0-B
// ---------------------------------------------------------------------------

/** Discriminant of a journal event. */
export type JournalEventType = string;

/**
 * The envelope every persisted event carries.
 *
 * `seq` is a per-board monotonic integer assigned by the journal writer.
 * `ts` is wall-clock and **display-only** — no derivation may read it, or replay
 * stops being deterministic.
 */
export interface EventEnvelope {
  v: number;
  seq: number;
  ts: number;
  type: JournalEventType;
}

/** A journal event: envelope plus a type-specific payload. Refined in P0-B. */
export type JournalEvent = EventEnvelope & Record<string, unknown>;

/** Result of validating a raw journal line. Refined in P0-B. */
export type ValidationResult =
  | { ok: true; event: JournalEvent; known: boolean }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Plan graph — populated by P0-F
// ---------------------------------------------------------------------------

/** One task as declared in a plan document. Refined in P0-F. */
export interface PlanTask {
  id: string;
  title: string;
  wave: number;
  dependsOn: string[];
  touches: string[];
}

/** A parsed, validated, acyclic plan. Refined in P0-F. */
export interface TaskGraph {
  name: string;
  tasks: PlanTask[];
}

/** A loud, locatable parse failure. Refined in P0-F. */
export interface ParseError {
  line: number;
  column: number;
  message: string;
  hint: string;
}

// ---------------------------------------------------------------------------
// Board state — populated by P0-C
// ---------------------------------------------------------------------------

/** One recorded attempt at a task. Refined in P0-C. */
export interface Attempt {
  attemptId: string;
  role: Role;
}

/**
 * Per-task derived state.
 *
 * There is deliberately **no attempt-count field.** Counts are derived by
 * filtering the journal; a counter would be a second source of truth. Refined in P0-C.
 */
export interface TaskState {
  id: string;
  phase: TaskPhase;
  attempts: Attempt[];
}

/** The whole board, derived. Refined in P0-C. */
export interface BoardState {
  boardId: string;
  status: BoardStatus;
  concurrency: number;
  tasks: Map<string, TaskState>;
}

// ---------------------------------------------------------------------------
// Scheduler — populated by P0-D
// ---------------------------------------------------------------------------

/** One attempt the scheduler wants running right now. Refined in P0-D. */
export interface Desired {
  taskId: string;
  role: Role;
  seedKind: SeedKind;
}

// ---------------------------------------------------------------------------
// Policy — populated by P0-E
// ---------------------------------------------------------------------------

/** What the policy table says happens next. Refined in P0-E. */
export type Action =
  | { kind: 'retry' }
  | { kind: 'abandon'; reason: string }
  | { kind: 'advance' };

// ---------------------------------------------------------------------------
// Snapshot — populated by P0-G
// ---------------------------------------------------------------------------

/** A memoisation cache for the fold. Never a source of truth. Refined in P0-G. */
export interface Snapshot {
  v: number;
  boardId: string;
  throughSeq: number;
  stateHash: string;
  state: unknown;
}
