/**
 * Shapes for the sub-agent graph. Separate from `server/orchestrator/core/types`
 * on purpose: dumping these into board `EVENT_SCHEMAS` would couple two
 * journals that share only an envelope.
 */

/** Envelope version this graph writes. Readers tolerate anything >= 1. */
export type EnvelopeVersion = number;

/**
 * Shared envelope. Same fields as P0-B: `v`, optional `seq` / `ts`, `type`.
 * `ts` is wall-clock and display-only — the fold must not read it.
 */
export interface EventEnvelope {
  v: number;
  seq?: number;
  ts?: number;
  type: string;
}

export type AttemptOutcome =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'no_report'
  | 'crashed'
  | 'timeout';

/** The only engine role this graph starts. Type names are not roles. */
export type SubAgentRole = 'sub-agent';

export type SeedKind = 'initial' | 'continue';

export type RunPhase = 'idle' | 'running' | 'passed' | 'abandoned' | 'cancelled';

export type AgentsStatus = 'idle' | 'running';

export type FieldType =
  | 'id'
  | 'str'
  | 'int'
  | 'posint'
  | 'str[]'
  | 'obj[]'
  | 'obj'
  | { enum: readonly string[] };

export interface EventSchema {
  readonly required: Readonly<Record<string, FieldType>>;
  readonly optional: Readonly<Record<string, FieldType>>;
}

export type ValidationResult =
  | { ok: true; event: Record<string, unknown>; known: boolean }
  | { ok: false; error: string };

export interface Attempt {
  attemptId: string;
  seedKind: SeedKind | string | null;
  seed: Record<string, unknown> | null;
  model: { providerId: string; id: string } | null;
  ended: boolean;
  outcome: AttemptOutcome | null;
  summary: string | null;
  evidence: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
}

export interface RunState {
  runId: string;
  type: string;
  task: string;
  parentChatId: string;
  cwd: string;
  requestedAt: number | null;
  phase: RunPhase;
  attempts: Attempt[];
  abandonedReason: string | null;
  abandonedEvidence: Record<string, unknown> | null;
  cancelledReason: 'user' | null;
  /** Folded from `result.delivered`. Pending vs delivered is this flag. */
  delivered: boolean;
  /** Why delivery was skipped, when `result.delivered` carried a skipReason. */
  deliveredSkipReason: 'missing_chat' | 'orchestrate' | null;
  /** Folded from `run.nudged`. Once-per-run check-in; survives reload. */
  nudged: boolean;
  /** Parent user-send turn — card placement / cancel-all after reload. */
  parentTurnId: string | null;
  /** Parent tool_call id — card anchor after reload. */
  parentToolCallId: string | null;
  /** Per-run model override from spawn; effector reads this first. */
  model: { providerId: string; id: string } | null;
}

export interface AgentsState {
  parentChatId: string;
  status: AgentsStatus;
  runs: Map<string, RunState>;
  runOrder: string[];
}

export interface Caps {
  globalMaxConcurrent: number;
  /** Missing types fall back to {@link DEFAULT_TYPE_MAX_CONCURRENT}. */
  maxConcurrentByType?: Readonly<Record<string, number>>;
}

export interface Desired {
  taskId: string;
  role: SubAgentRole;
  seedKind?: SeedKind;
}

export type Action =
  | { kind: 'retry'; seedKind: SeedKind }
  | { kind: 'deliver' }
  | { kind: 'done'; reason: string }
  | { kind: 'abandon'; reason: string; evidence?: Record<string, unknown> };

export type NextAction =
  | { kind: 'start'; role: SubAgentRole; seedKind: SeedKind }
  | { kind: 'abandon'; reason: string; evidence: Record<string, unknown> }
  | { kind: 'none' };

export interface PolicyRow {
  readonly outcome: string;
  readonly under: number | null;
  readonly action: Action;
}
