import type { RunnerDeps } from './adapters';
import type { TranscriptStore } from './transcript-store';

/**
 * Six-way **object** union from PRD §5.3 / §9.
 *
 * Named `TurnResult` here because `server/orchestrator/core` already exports
 * `AttemptResult` as the **string** alias (`'pass' | 'fail' | …`). Do not smash
 * those types together. P2-F maps `result.outcome` onto the core string.
 *
 * `AttemptResult` is re-exported as an alias of this object union so PRD §9
 * call sites can use the spec name without importing the core.
 */
export type TurnResult =
  | { outcome: 'pass'; summary: string; evidence: string[] }
  | { outcome: 'fail'; summary: string; blockers: string[] }
  | { outcome: 'blocked'; summary: string; needs: string[] }
  | { outcome: 'no_report' }
  | { outcome: 'crashed'; error: string }
  | { outcome: 'timeout' };

/** PRD name for {@link TurnResult}. Distinct from the core string `AttemptResult`. */
export type AttemptResult = TurnResult;

/**
 * Presentation-free stream events. The caller decides DOM vs SSE vs nothing.
 * Changing this shape is a Phase 6 finding — record it as one.
 */
export type TurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; id?: string; arguments?: unknown }
  | { type: 'tool_result'; name: string; id?: string; content: string };

/** Provider + model + sampler + thinking. Resolved by the caller, never looked up by chatId. */
export interface TurnModel {
  providerId: string;
  id: string;
  sampler?: { preset: Record<string, unknown>; maxTokens: number };
  thinking?: { mode: 'on' | 'off'; budgetTokens?: number | null };
}

/**
 * Caps the loop. `maxTurns` counts completion requests (including inner
 * finalization). Hitting either `maxTurns` or `wallClockMs` is `timeout`.
 */
export interface TurnLimits {
  maxTurns?: number;
  wallClockMs?: number;
  /** Forwarded to the P2-A loop's context policy. Opaque to this wrapper. */
  contextBudget?: unknown;
  modelContextLimit?: number | null;
}

/**
 * Result of parsing a report-tool payload at execute-time (P2-E).
 *
 * `ok: false` is a tool-boundary rejection the agent can retry. It is not
 * `no_report` — that outcome is only for a turn that never succeeded.
 */
export type ParseReportResult =
  | { ok: true; result: TurnResult }
  | { ok: false; error: string };

/** Injected report parser. Role-specific schemas live in the orchestrator. */
export type ParseReport = (raw: unknown) => ParseReportResult;

/** OpenAI function-tool shape the inner loop already sends on the wire. */
export interface TurnToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface RunTurnOptions {
  /** Opaque correlation id. Never interpreted (not a board lookup, not a UUID parse). */
  chatId: string;
  /** Opening user message. */
  seed: string;
  /** Resolved tool definitions. `ask_question` is callable iff it is in this list. */
  tools: TurnToolDefinition[];
  model: TurnModel;
  /** Streaming callback. Optional — omit to run headless. */
  onEvent?: (event: TurnEvent) => void;
  /** Worktree / workspace cwd. Forwarded to tool execute context; this wrapper does not chdir. */
  cwd?: string;
  /** P2-A transcript store. Falls back to `deps.transcriptStore`. */
  transcript?: TranscriptStore;
  signal?: AbortSignal;
  limits?: TurnLimits;
  /** P2-A injected I/O. Completions and tool dispatch stay injected (P2-C / P2-D). */
  deps: RunnerDeps;
  /**
   * Injected report tool. Default `report_outcome`. Not a builder/tester role name.
   * P2-E supplies the real schemas via {@link parseReport}; this wrapper only
   * captures a successful parse.
   */
  reportToolName?: string;
  /**
   * How to accept a report-tool payload. Default: the PRD six-way union.
   *
   * **Phase 6 finding:** added so a caller can reject a malformed report at
   * execute-time (the model retries inside the turn) without the runner knowing
   * Builder vs Tester. A rejected report is not `no_report`.
   */
  parseReport?: ParseReport;
  /**
   * System prompt for the inner loop. Default is a domain-free report reminder.
   *
   * **Phase 6 finding:** added so P2-F can inject Builder/Tester prompts
   * without the runner knowing what a role is. Omit to keep the default.
   */
  systemPrompt?: string;
  /** Optional execute for non-report tools. P2-D replaces the batch dispatcher, not this. */
  execute?: (
    name: string,
    args: unknown,
    ctx: { toolCallId: string; chatId: string; cwd?: string },
  ) => Promise<{ content: string }>;
}

export const DEFAULT_REPORT_TOOL_NAME: 'report_outcome';

/**
 * Board-agnostic turn entry (PRD §9).
 *
 * **Any change to this signature is a Phase 6 finding and must be recorded as one.**
 */
export function runTurn(options: RunTurnOptions): Promise<TurnResult>;
