/**
 * Sub-agent orchestration types (Step 09).
 */

import type { AgentContextBudgetConfig } from '../chat/context-budget';
import type { ApiMessage, BoardCategory, Stats, Usage } from '../types';
import type { OpenAIFunctionDefinition } from '../tools/definitions';

/** Lifecycle status for a sub-agent run. */
export type SubAgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Why a sub-agent run reached a terminal status (parent status tools). */
export type SubAgentTerminalReason =
  | 'success'
  | 'max_tool_turns'
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
  /** Max LLM↔tool rounds before the run fails (configurable in ~/.minnow/sub-agents.json). */
  maxToolTurns: number;
  workAgentId: string | null;
  allowedTools: string[] | null;
  deniedTools: string[];
  systemPromptPath: string | null;
  maxInputTokens?: number | null;
  contextEnforcementPolicy?: import('../chat/context-budget').ContextEnforcementPolicy;
  minRecentTurns?: number;
  summaryReserveTokens?: number;
}

/** Root sub-agents.json shape (user + merged). */
export interface SubAgentsFile {
  version: number;
  enabled: boolean;
  globalMaxConcurrent: number;
  defaultTimeoutMs: number;
  /** Fallback max tool rounds when a type omits `maxToolTurns`. */
  defaultMaxToolTurns?: number;
  types: Record<string, SubAgentTypeConfig>;
}

/** One orchestrated sub-agent execution. */
export interface SubAgentRun {
  runId: string;
  type: string;
  task: string;
  status: SubAgentStatus;
  /** Parent chat id for tool approval UI when sub-agent tools run. */
  parentChatId: string | null;
  /** Parent assistant `tool_calls[].id` when spawned from the main tool loop (UI anchor). */
  parentToolCallId: string | null;
  parentTurnId: string | null;
  summary: string;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  toolTurns: number;
  /** Configured cap for this run (from type config at spawn). */
  maxToolTurns: number;
  cancelled: boolean;
  messages: ApiMessage[];
  /**
   * Count of nested tool invocations so far (UI progress); cleared when the run settles.
   * Distinct from `toolTurns`, which reflects the runner’s completed tool rounds in the summary.
   */
  liveNestedToolCalls?: number;
  /** Last nested tool name invoked (activity panel). */
  liveCurrentToolName?: string | null;
  /** Resolved provider for this run (set when execution starts). */
  providerId?: string;
  /** Resolved model for this run (set when execution starts). */
  modelId?: string;
  /** Board category chip (Orchestrate board agent grid). */
  category?: BoardCategory;
  /** Linked board task id when spawned from board_init tasks. */
  boardTaskId?: string | null;
  /** Token usage accumulated across sub-agent LLM turns (Orchestrate stats rollup). */
  usage?: Usage;
  /** Timing stats per turn, averaged when rolled into parent lastStats. */
  stats?: Stats;
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
  /** Board category for Orchestrate board UI. */
  category?: BoardCategory;
  /** Board task id (board_update_task / spawn hook). */
  boardTaskId?: string | null;
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

/** Serialized parent tool result (static shape in tests). */
export interface AggregateResult {
  runId: string;
  type: string;
  status: SubAgentStatus;
  summary: string;
  startedAt: string | null;
  endedAt: string | null;
  toolTurns: number;
  cancelled: boolean;
  error?: string;
  terminalReason?: SubAgentTerminalReason;
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
  toolTurns: number;
  messages: ApiMessage[];
  /** True when the tool loop hit {@link SubAgentRunner.run maxToolTurns} without a final answer. */
  toolTurnLimitExhausted?: boolean;
  usage?: Usage;
  stats?: Stats;
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
    maxToolTurns: number;
    contextBudget?: AgentContextBudgetConfig;
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
    /** Called whenever the in-flight transcript changes (streaming + tools). */
    onMessagesChange?: (messages: ApiMessage[]) => void;
  }): Promise<SubAgentRunnerOutput>;
}
