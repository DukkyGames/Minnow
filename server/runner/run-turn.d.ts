import type { RunnerDeps } from './adapters';
import type { TranscriptMessage, TranscriptStore } from './transcript-store';

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
/**
 * Tokens a turn spent, summed across every completion it made — the tool loop
 * and any finalization included. Absent when the provider reported no usage.
 *
 * Present on every outcome, deliberately: a crashed or timed-out attempt is
 * exactly the kind worth costing.
 */
export interface TurnUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: number | undefined;
}

export type TurnResult =
  | { outcome: 'pass'; summary: string; evidence: string[]; usage?: TurnUsage }
  | { outcome: 'fail'; summary: string; blockers: string[]; usage?: TurnUsage }
  | { outcome: 'blocked'; summary: string; needs: string[]; usage?: TurnUsage }
  | { outcome: 'no_report'; usage?: TurnUsage }
  | { outcome: 'crashed'; error: string; usage?: TurnUsage }
  | { outcome: 'timeout'; usage?: TurnUsage };

/** PRD name for {@link TurnResult}. Distinct from the core string `AttemptResult`. */
export type AttemptResult = TurnResult;

/**
 * Inner-loop stream phase. The runner's own word — callers map it to chrome
 * labels. Not a product status string.
 */
export type TurnPhase = 'generating' | 'thinking' | 'tools';

/**
 * Presentation-free stream events. The caller decides DOM vs SSE vs nothing.
 * Changing this shape is a Phase 6 finding — record it as one.
 *
 * **P10-B / MIN-767:** widened so a chat caller can rebuild per-round chrome
 * from events the inner loop already computed and used to drop. `phase`,
 * `reasoning_end`, `stream_meta`, `round_start`, and `round_end` are new.
 * `tool_result` now carries the whole execute outcome (`attachments`,
 * `codeChange`, `isError`) and always fires, including parseError / abort
 * fills (emit moved onto `onToolDone`). Disk transcripts classify flood
 * types with {@link isHighFrequencyTurnEvent}. Sub-agent live SSE uses
 * {@link shouldEmitSubAgentLiveTurnEvent} so `phase` reaches cards (P10-L).
 */
export type TurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  /** Tool name while arguments are still streaming (inner `onToolCallDelta`). */
  | { type: 'tool_streaming'; name: string }
  | { type: 'tool_call'; name: string; id?: string; arguments?: unknown }
  | {
      type: 'tool_result';
      name: string;
      id?: string;
      content: string;
      attachments?: unknown[];
      codeChange?: unknown;
      isError?: boolean;
    }
  | { type: 'phase'; phase: TurnPhase }
  | { type: 'reasoning_end' }
  | {
      type: 'stream_meta';
      usage?: Record<string, number>;
      stats?: Record<string, unknown>;
      runtime?: unknown;
      model?: string;
      finishReason?: string;
    }
  | { type: 'round_start'; index: number }
  | {
      type: 'round_end';
      index: number;
      text: string;
      reasoning: string;
      toolCallCount: number;
      usage?: Record<string, number>;
      stats?: Record<string, unknown>;
      finishReason?: string;
      t0: number;
      tFirst: number | null;
      tEnd: number;
    };

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

/**
 * How the inner loop opens the transcript.
 *
 * - omitted / `'isolated'` — `[system, user(seed)]`. Board callers that pass
 *   only `seed` keep this (P2-B).
 * - `'continue'` — load `transcript.load(chatId).messages`, skip a leading
 *   system row (this turn's {@link RunTurnOptions.systemPrompt} wins), and
 *   append `user(seed)` unless the last row is already that user message.
 *
 * **Phase 6 finding (P6-C / MIN-725):** chat cannot continue a conversation
 * from `seed` alone. Persist in continue mode suffixes product rows and does
 * not splice a second system+user into the store.
 *
 * **Phase 10 finding (P10-C / MIN-768):** continue persist is incremental on
 * every settled `onMessagesChange` (see {@link MessagesChangeMeta}), not once
 * in `finally`. Isolated persist is unchanged.
 */
export type TurnSeedKind = 'isolated' | 'continue';

/**
 * Meta on the inner `onMessagesChange` callback (P10-C / MIN-768).
 *
 * Not a `runTurn` option — the wrapper consumes it to persist continue turns
 * incrementally. Forced emits after a real `messages.push` are `settled: true`;
 * throttled stream clones (synthetic partial assistant) are `false`. Existing
 * callers that ignore the second argument stay valid.
 */
export interface MessagesChangeMeta {
  settled: boolean;
}

export interface RunTurnOptions {
  /** Opaque correlation id. Never interpreted (not a board lookup, not a UUID parse). */
  chatId: string;
  /** Opening user message. */
  seed: string;
  /**
   * Prior transcript for a multi-turn continuation (no leading system required).
   * When set, the inner loop starts `[systemPrompt, ...messages]` and appends
   * `user(seed)` unless `messages` already ends with that user row.
   *
   * Omit together with {@link seedKind} `'isolated'` (default) for today's
   * one-shot `[system, user(seed)]`.
   *
   * **Phase 6 finding (P6-C / MIN-725).** Wins over {@link seedKind} `'continue'`.
   */
  messages?: TranscriptMessage[];
  /**
   * `'continue'` loads `transcript.load(chatId).messages` as the prior
   * transcript (same rules as {@link messages}). Default / `'isolated'` is
   * the P2-B one-shot. Board callers that pass only `seed` are unchanged.
   *
   * **Phase 6 finding (P6-C / MIN-725).**
   */
  seedKind?: TurnSeedKind;
  /**
   * Caller tool list. `ask_question` is added or stripped by {@link ask},
   * not by this array — injection decides the resolved list.
   */
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
   *
   * Pass `null` to omit injection (same as {@link injectReportTool} `false`).
   * Chat does this. Board callers keep the default string.
   *
   * **Phase 6 finding (P6-C / MIN-725):** report-tool injection is optional.
   * There is no `isBoard` branch — the caller says whether it wants a report tool.
   */
  reportToolName?: string | null;
  /**
   * When `false`, do not append a report tool. Default `true` (inject
   * {@link DEFAULT_REPORT_TOOL_NAME} when missing). Chat passes `false`.
   *
   * **Phase 6 finding (P6-C / MIN-725).**
   */
  injectReportTool?: boolean;
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
  /**
   * Interactive `ask_question` handler. Presence of `ask()` puts the tool on
   * the resolved list; `null` / omitted strips it even if the caller passed
   * the schema in `tools`.
   *
   * **Phase 6 finding (P6-B / MIN-724):** PRD §9 injected capability. The
   * runner has no board-vs-chat branch — unattended callers pass `null`.
   */
  ask?: AskCapability | null;
  /**
   * Watchdog for an unanswered interactive question. Default
   * {@link DEFAULT_ASK_TIMEOUT_MS} (60 min, same as Watchdog generation idle).
   * Ignored when `ask` is null — that path errors immediately. Test hook:
   * pass a small positive number. `0` / negative fall back to the default
   * (never disable — a chat turn must not hang forever).
   */
  askTimeoutMs?: number;
  /**
   * When `false`, skip the inner-loop `SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION`
   * user row (prose with tools available and zero tool turns). Default `true`
   * so board / sub-agent callers keep today's behaviour. Chat passes `false`.
   *
   * **Phase 6 finding (P6-C / MIN-725).**
   */
  nudgeToolUse?: boolean;
  /**
   * When `false`, skip `requestStructuredOutcome` / prose JSON finalization.
   * Default `true`. Chat and the board effector pass `false`. Sub-agents omit
   * this (stay on). Boards then nudge `reportToolName` instead of dumping
   * `summary` / `findings` / `artifacts` JSON.
   *
   * **Phase 6 finding (P6-C / MIN-725).**
   */
  finalizeStructuredOutcome?: boolean;
  /**
   * Forwarded to the inner loop when finalization is on. Chat omits it.
   * Already existed on the inner runner; threaded through `runTurn` so a
   * caller can pass a schema without wrapping `createSubAgentRunner`.
   */
  summarySchema?: string;
  /**
   * Consulted at each tool-loop boundary (the top of every inner-loop
   * iteration, including after tools and before the next completion).
   * Return rows to splice into the in-memory transcript, or `null`.
   *
   * **Phase 6 finding (P10-I / MIN-774):** in-turn steer is an injected
   * hook, not an `isChat` branch — same shape as {@link AskCapability}.
   * Chat implements this with `consumePendingSteer`. Board and sub-agent
   * callers omit it and are unchanged.
   *
   * Sync on purpose: the pending row is already queued. Do not wait on a
   * human here (that is `ask`).
   */
  onRoundBoundary?: () => TranscriptMessage[] | null;
  /** Optional execute for non-report / non-ask tools. P2-D replaces the batch dispatcher, not this. */
  execute?: (
    name: string,
    args: unknown,
    ctx: { toolCallId: string; chatId: string; cwd?: string },
  ) => Promise<{ content: string }>;
}

export const DEFAULT_REPORT_TOOL_NAME: 'report_outcome';
export const ASK_QUESTION_TOOL_NAME: 'ask_question';
export const DEFAULT_ASK_TIMEOUT_MS: number;
export const ASK_QUESTION_UNAVAILABLE_ERROR: string;
export const ASK_QUESTION_TIMEOUT_ERROR: string;

export { buildOpeningMessages, buildOpeningTranscript } from './opening-messages';

/**
 * Apply ask-capability injection then optionally ensure the report tool.
 * The list the model sees — not the caller's raw `tools` array.
 *
 * `injectReportTool: false` or `reportToolName: null` omits the report tool.
 * Default remains inject-on so board-shaped callers are unchanged.
 */
export function resolveTurnTools(
  tools: TurnToolDefinition[] | undefined,
  options?: {
    reportToolName?: string | null;
    injectReportTool?: boolean;
    ask?: AskCapability | null;
  },
): TurnToolDefinition[];

/**
 * Handler a caller injects so `runTurn` can wait on a human. Return a tool
 * JSON string, `{ content: string }`, or a `{ status, answers }` object.
 */
export interface AskCapability {
  ask(
    question: unknown,
    ctx: { signal: AbortSignal; chatId: string },
  ): Promise<unknown>;
}

/**
 * Board-agnostic turn entry (PRD §9).
 *
 * **Any change to this signature is a Phase 6 finding and must be recorded as one.**
 *
 * P6-A (MIN-723) did not change this signature. P6-B (MIN-724) added `ask`
 * / `askTimeoutMs` so interactivity is an injected capability (PRD §9), not
 * a product branch. P6-C (MIN-725) added history continuation (`messages` /
 * `seedKind: 'continue'`), optional report-tool injection, and gates for the
 * inner sub-agent nudge + structured-outcome finalization. Chat maps
 * `no_report` → turn complete (finding 3 option a — no new `TurnResult`
 * outcome). P10-B (MIN-767) widened `TurnEvent` (rounds, phase, stream_meta,
 * full tool_result via `onToolDone`) and added `isHighFrequencyTurnEvent`.
 * P10-I (MIN-774) added {@link RunTurnOptions.onRoundBoundary} so in-turn
 * steer is an injected hook, not an abort. There is still no `isBoard` branch.
 */
export function runTurn(options: RunTurnOptions): Promise<TurnResult>;
