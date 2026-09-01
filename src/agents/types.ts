/**
 * Sub-agent orchestration types (Step 09).
 */

import type { AgentContextBudgetConfig, ContextEnforcementPolicy } from '../chat/context-budget';
import type { ApiMessage, BoardCategory, Stats, Usage } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';
import type { MessagesChangeMeta, TurnEvent } from '../../server/runner/run-turn';
import type {
  SubAgentBudgetEvent,
  SubAgentStructuredOutcome,
} from './sub-agent-structured-outcome';
import type { SamplerPreset } from './sampler-types';
import type { ThinkingTriState } from './thinking-types';

/** Re-export of the shared runner stream-event union (P10-B / MIN-767). */
export type { TurnEvent, MessagesChangeMeta };

/** Lifecycle status for a sub-agent run. */
export type SubAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Fine-grained run lifecycle (MIN-140 Phase 2 watchdog). */
export type RunLifecycle =
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'suspect'
  | 'recovering'
  | 'completed'
  | 'done_unacked'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** Map coarse {@link SubAgentStatus} to default lifecycle when unset. */
export function deriveLifecycleFromStatus(status: SubAgentStatus): RunLifecycle {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'running';
  }
}

/** Why a sub-agent run reached a terminal status (parent status tools). */
export type SubAgentTerminalReason =
  | 'success'
  | 'max_tool_turns'
  | 'context_budget'
  | 'failed'
  | 'cancelled';

/** Per-type configuration merged from defaults and ~/.minnow/sub-agents.json. */
export interface SubAgentTypeConfig {
  label?: string;
  enabled: boolean;
  providerId: string;
  modelId: string;
  maxConcurrent: number;
  timeoutMs: number;
  workAgentId: string | null;
  allowedTools: string[] | null;
  deniedTools: string[];
  systemPromptPath: string | null;
  maxInputTokens?: number | null;
  contextEnforcementPolicy?: ContextEnforcementPolicy;
  minRecentTurns?: number;
  summaryReserveTokens?: number;
  /** Preset id for structured final outcome validation (e.g. minnow.sub-agent.v1). */
  summarySchema?: string;
  /** Per-type sampler preset (shipped default + user partial override). */
  sampler?: SamplerPreset;
  /** Per-type thinking tri-state (shipped default + user override). */
  thinkingMode?: ThinkingTriState;
  /** Per-type thinking token budget; null = inherit, 0 = off. */
  thinkingBudgetTokens?: number | null;
}

/** Root sub-agents.json shape (user + merged). */
export interface SubAgentsFile {
  version: number;
  enabled: boolean;
  globalMaxConcurrent: number;
  defaultTimeoutMs: number;
  /**
   * One-shot parent check-in nudge while a sub-agent is still running (ms).
   * `0` disables. Default 120_000 from shipped defaults.
   */
  checkInNudgeMs?: number;
  defaultMaxInputTokens?: number | null;
  defaultContextEnforcementPolicy?: ContextEnforcementPolicy;
  defaultSummarySchema?: string;
  types: Record<string, SubAgentTypeConfig>;
}

/** One orchestrated sub-agent execution. */
export interface SubAgentRun {
  runId: string;
  type: string;
  task: string;
  status: SubAgentStatus;
  /** Watchdog lifecycle; defaults from {@link deriveLifecycleFromStatus}(status). */
  lifecycle?: RunLifecycle;
  /** Parent chat id for tool approval UI when sub-agent tools run. */
  parentChatId: string | null;
  /** Parent assistant `tool_calls[].id` when spawned from the main tool loop (UI anchor). */
  parentToolCallId: string | null;
  parentTurnId: string | null;
  summary: string;
  /** Parsed structured handoff for parent tools (MIN-43). */
  structuredOutcome?: SubAgentStructuredOutcome;
  /** Context budget enforcement events (short labels). */
  budgetEvents?: SubAgentBudgetEvent[];
  /** Resolved cap at spawn (aggregate metadata). */
  contextBudgetMaxInputTokens?: number | null;
  contextBudgetPolicy?: ContextEnforcementPolicy;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  toolTurns: number;
  /** @deprecated Ignored; retained for persisted run records from older versions. */
  maxToolTurns?: number;
  cancelled: boolean;
  messages: ApiMessage[];
  /**
   * Count of nested tool invocations so far (UI progress); cleared when the run settles.
   * Distinct from `toolTurns`, which reflects the runner’s completed tool rounds in the summary.
   */
  liveNestedToolCalls?: number;
  /** Last nested tool name invoked (activity panel). */
  liveCurrentToolName?: string | null;
  /** In-flight stream phase for drawer/cards (cleared when the run settles). */
  livePhase?: SubAgentLivePhase | null;
  /** Partial reasoning text while `livePhase` is `thinking` (drawer activity tail). */
  livePartialReasoning?: string;
  /** Throttled assistant prose while `livePhase` is `generating` (drawer live tail). */
  livePartialText?: string;
  /**
   * Fold attempt count. Queued-active means zero attempts (waiting for a slot).
   * Idle between retry and abandon has attempts and must not sit in Agent activity.
   */
  foldAttemptCount?: number;
  /** Resolved provider for this run (set when execution starts). */
  providerId?: string;
  /** Resolved model for this run (set when execution starts). */
  modelId?: string;
  /** Board category chip (Orchestrate board agent grid). */
  category?: BoardCategory;
  /** Linked leftover board task id. */
  boardTaskId?: string | null;
  /** Token usage accumulated across sub-agent LLM turns (Orchestrate stats rollup). */
  usage?: Usage;
  /** Timing stats per turn, averaged when rolled into parent lastStats. */
  stats?: Stats;
  /**
   * Start precondition failing (SSE `event: error`, P9-A). Not journaled.
   * `consecutive` is a counter — the view must not toast once per tick.
   */
  startError?: { message: string; consecutive: number } | null;
  /** Folded from `result.delivered`. The completion-push adapter reads this. */
  delivered?: boolean;
}

/** Input to spawn a sub-agent. */
export interface SpawnSubAgentInput {
  type: string;
  task: string;
  wait?: boolean;
  parentTurnId?: string | null;
  /** Parent chat id for tool approval modals during sub-agent runs. */
  parentChatId?: string | null;
  /** Parent `tool_calls[].id` for the spawn invocation (card placement). */
  parentToolCallId?: string | null;
  /** Parent mode for tool policy when resolving enabled tools. */
  modeId?: string;
  /** Optional provider override (Super Plan reviewer model, etc.). */
  providerId?: string;
  /** Optional model override (Super Plan reviewer model, etc.). */
  modelId?: string;
  /** Board category for Orchestrate board UI. */
  category?: BoardCategory;
  /** Leftover board task id (spawn hook). */
  boardTaskId?: string | null;
  /** Per-spawn wall-clock timeout override (ms); wins over type/global defaults. */
  timeoutMs?: number;
}

/** Immediate spawn acknowledgement. */
export interface SpawnSubAgentResult {
  runId: string;
  status: SubAgentStatus;
}

/** Cancel tool / API result. */
export interface CancelSubAgentResult {
  ok: boolean;
  runId: string;
  status: SubAgentStatus;
}

/** Context budget metadata on parent aggregate JSON. */
export interface AggregateContextBudgetInfo {
  maxInputTokens: number;
  estimatedInputTokens: number;
  policy: string;
  events: string[];
}

/** Serialized parent tool result (static shape in tests). */
export interface AggregateResult {
  runId: string;
  type: string;
  status: SubAgentStatus;
  summary: string;
  outcome: SubAgentStructuredOutcome;
  startedAt: string | null;
  endedAt: string | null;
  toolTurns: number;
  cancelled: boolean;
  error?: string;
  terminalReason?: SubAgentTerminalReason;
  contextBudget?: AggregateContextBudgetInfo;
}

/** Context passed from the parent tool loop into spawn/cancel executors. */
export interface SubAgentExecutorContext {
  parentTurnId: string;
  modeId: string;
  /** When set, nested tool approvals are attributed to this chat. */
  parentChatId?: string;
  /** Current parent tool_call id (spawn/cancel correlation). */
  parentToolCallId?: string;
}

/** Runner output after an isolated sub-agent completes. */
export interface SubAgentRunnerOutput {
  summary: string;
  structuredOutcome?: SubAgentStructuredOutcome;
  toolTurns: number;
  messages: ApiMessage[];
  /** @deprecated Real runners no longer cap tool turns; retained for custom/test runners. */
  toolTurnLimitExhausted?: boolean;
  /** True when input tokens could not be reduced under the cap. */
  contextBudgetExhausted?: boolean;
  budgetEvents?: SubAgentBudgetEvent[];
  /** Set when final JSON could not be parsed or validated. */
  structuredOutcomeParseError?: string;
  usage?: Usage;
  stats?: Stats;
}

/** Live stream phase mirrored from main-chat UX (thinking → generating → tools). */
export type SubAgentLivePhase = 'thinking' | 'generating' | 'tools' | 'stopping';

/** Snapshot pushed while a sub-agent turn is in flight (drawer/cards). */
export interface SubAgentLiveActivity {
  phase: SubAgentLivePhase | null;
  partialReasoning?: string;
  currentToolName?: string | null;
}

/** Injectable runner for tests (deterministic mock). */
export interface SubAgentRunner {
  run(input: {
    runId: string;
    type: string;
    task: string;
    systemPrompt: string;
    tools: OpenAIFunctionDefinition[];
    providerId: string;
    modelId: string;
    /** Parent chat for token ledger attribution. */
    parentChatId?: string | null;
    contextBudget?: AgentContextBudgetConfig;
    summarySchema?: string;
    /**
     * Prior transcript for a continuation (P6-C). Omit for isolated
     * `[system, user(task)]`.
     */
    priorMessages?: unknown[];
    /**
     * When false, skip the tool-use nudge user row. Default true.
     */
    nudgeToolUse?: boolean;
    /**
     * When false, skip structured-outcome finalization. Default true.
     */
    finalizeStructuredOutcome?: boolean;
    /**
     * When set and `finalizeStructuredOutcome` is false, nudge this tool
     * once before ending the inner loop (board `report_outcome`).
     */
    reportToolName?: string | null;
    modelContextLimit?: number | null;
    signal: AbortSignal;
    /** Passed into each nested tool call (chat id, sub-agent label). */
    toolExecuteContext?: {
      chatId?: string;
      subAgentType?: string;
    };
    executeTool: (
      name: string,
      args: Record<string, unknown>,
      toolContext?: import('../tools/client').ExecuteToolContext,
    ) => Promise<import('../types').ToolExecutionResult>;
    /**
     * Called whenever the in-flight transcript changes (streaming + tools).
     * `meta.settled` is true after a real `messages.push` (forced emit) and
     * false for throttled stream clones that carry a synthetic partial
     * assistant row. Second argument is optional so older callers keep working.
     * P10-C / MIN-768.
     */
    onMessagesChange?: (messages: ApiMessage[], meta?: MessagesChangeMeta) => void;
    /** Called when stream phase or partial reasoning/tool name changes. */
    onLiveActivity?: (activity: SubAgentLiveActivity) => void;
    /**
     * Presentation-free turn events the inner loop already computed
     * (`round_start` / `round_end` / `reasoning_end` / `stream_meta`).
     * `runTurn` forwards these onto its `onEvent`. Optional — omit to run
     * headless. P10-B / MIN-767.
     */
    onTurnEvent?: (event: TurnEvent) => void;
    /**
     * One turn's token usage, reported as it lands rather than only in the
     * return value. A run that unwinds by throwing — a reported outcome, a
     * timeout, an abort — never reaches the return, so this is the only
     * accounting that survives every exit path.
     */
    onUsage?: (usage: Record<string, number>) => void;
    /**
     * Consulted at each tool-loop boundary. Return rows to splice, or null.
     * P10-I / MIN-774 — injected like `ask`, not an isChat branch. Board
     * and sub-agent callers omit it.
     */
    onRoundBoundary?: () => unknown[] | null;
  }): Promise<SubAgentRunnerOutput>;
}
