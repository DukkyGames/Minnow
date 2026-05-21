/**
 * Shared data shapes for sessions, LM Studio API payloads, and UI metrics.
 * Mirrors structures in `scripts/_extracted-app.js` / legacy `index.html`.
 */

import type { ModeId } from './chat/modes/types';

/** Persisted session blob schema version (`minnow-sessions-v1` key; version inside JSON). */
export const SESSION_SCHEMA_VERSION = 2 as const;

export type SessionSchemaVersion = typeof SESSION_SCHEMA_VERSION;

/** Roles stored in chat history (UI + localStorage). */
export type ChatRole = 'user' | 'assistant' | 'tool';

/** Roles sent to LM Studio chat completions (includes ephemeral system prompt). */
export type ApiChatRole = 'system' | ChatRole;

/** OpenAI-compatible function tool invocation (complete, after streaming finalize). */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** One fragment of a streaming `tool_calls` delta (indexed by `index`). */
export interface ChatCompletionToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Token usage from LM Studio completion chunks or non-streaming responses. */
export interface Usage {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** Inference timing and finish metadata for a single assistant turn. */
export interface Stats {
  tokens_per_second?: number;
  time_to_first_token?: number;
  generation_time?: number;
  stop_reason?: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

/** Assistant history entry; may include per-bubble metric chips when restored. */
export interface AssistantMessage {
  role: 'assistant';
  content: string;
  /** Ordered reasoning segments from LM Studio (when Developer reasoning split is on). */
  thinking?: string[];
  /** Accumulated reasoning-active wall time for this reply (ms), not TTFT. */
  thinkingDurationMs?: number;
  /** User stopped generation before the model finished. */
  stopped?: boolean;
  stats?: Stats;
  usage?: Usage;
}

/** Assistant turn that requested one or more tool calls (`finish_reason: tool_calls`). */
export interface AssistantToolCallMessage {
  role: 'assistant';
  content: string | null;
  tool_calls: ToolCall[];
  stats?: Stats;
  usage?: Usage;
}

/** Inline image attachment from server tools (e.g. browser_screenshot). */
export interface ToolImageAttachment {
  type: 'image';
  url: string;
  mime: 'image/png';
  alt?: string;
}

/** Tool execution result correlated to `tool_call_id` from the prior assistant turn. */
export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
  attachments?: ToolImageAttachment[];
}

/** Result returned from executeTool (text + optional UI attachments). */
export interface ToolExecutionResult {
  content: string;
  attachments?: ToolImageAttachment[];
}

export type Message =
  | UserMessage
  | AssistantMessage
  | AssistantToolCallMessage
  | ToolResultMessage;

/** Multimodal user/assistant payload part (attachments use in later waves). */
export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

/** API message body: plain string or multimodal parts. */
export type ApiMessageContent = string | ContentPart[] | null;

export interface ApiSystemMessage {
  role: 'system';
  content: string;
}

export interface ApiUserMessage {
  role: 'user';
  content: ApiMessageContent;
}

export interface ApiAssistantMessage {
  role: 'assistant';
  content: ApiMessageContent;
  tool_calls?: ToolCall[];
}

export interface ApiToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/**
 * Flat snapshot of the last completed assistant turn for sidebar preview
 * and the bottom stats strip when switching chats.
 */
export interface LastStats {
  tokens_per_second: number | null;
  time_to_first_token: number | null;
  generation_time: number | null;
  stop_reason: string | null;
  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

/** Merged arch / quant / context shown in the stats strip (`resolveModelInfo`). */
export interface ModelInfo {
  arch?: string;
  quant?: string;
  context_length?: number;
}

/** Per-chat expert picker state (Step 06). */
export interface ExpertSelection {
  mode: 'auto' | 'manual';
  expertId: string | null;
}

/** One completed terminal run persisted on the chat (Step 10). */
export interface TerminalRunRecord {
  id: string;
  command: string;
  cwd: string;
  source: 'user' | 'agent';
  toolCallId?: string;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  timedOut: boolean;
  /** Path relative to ~/.minnow (e.g. logs/terminal/<runId>.log). */
  logPath: string;
}

/** Lifecycle values persisted for sub-agent runs on the parent chat. */
export type PersistedSubAgentStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Snapshot of a sub-agent run saved on the parent chat when the run reaches a
 * terminal state (for drawer restore after session reload).
 */
export interface PersistedSubAgentRun {
  runId: string;
  parentTurnId: string;
  /** Parent assistant tool_call id when known (optional). */
  parentToolCallId?: string;
  type: string;
  task: string;
  status: PersistedSubAgentStatus;
  summary: string;
  error?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  toolTurns: number;
  /** Transcript (ApiMessage-shaped JSON); capped when persisting. */
  messages: unknown[];
  /** Board category when spawned from Orchestrate board (restore drawer/cards). */
  category?: BoardCategory;
  /** Linked board task id (e.g. W1-A). */
  boardTaskId?: string | null;
}

/** Orchestrate board task lifecycle. */
export type BoardTaskStatus =
  | 'planned'
  | 'in_progress'
  | 'testing'
  | 'complete'
  | 'failed'
  | 'blocked';

/** Sub-agent category for board agent grid styling. */
export type BoardCategory = 'build' | 'fix' | 'test' | 'research';

/** One task on the Orchestrate Kanban board. */
export interface BoardTask {
  id: string;
  title: string;
  wave: number | string;
  category: BoardCategory;
  status: BoardTaskStatus;
  assignedRunId?: string;
  startedAt?: number;
  endedAt?: number;
  filesChanged?: number;
  notes?: string;
  error?: string;
}

/** Wave rollup row (status derived from tasks). */
export interface BoardWave {
  id: number | string;
  status: BoardTaskStatus;
  taskCount?: number;
  completeCount?: number;
}

/** Structured Orchestrate plan execution state (persisted on chat). */
export interface OrchestrateBoardState {
  planPath: string;
  tasks: BoardTask[];
  waves: BoardWave[];
  startedAt: number;
  lastUpdatedAt: number;
  /** Parent turn id for Stop orchestrator (minted in tool loop). */
  activeParentTurnId?: string;
}

export interface Chat {
  id: string;
  name: string;
  /** Normalized absolute workspace root at chat creation; '' = unassigned (legacy). */
  workspacePath: string;
  modelId: string;
  /** Optional per-chat provider override (Step 03). */
  providerId?: string;
  /** Operating mode for prompt + tool policy (Step 05); default build. */
  modeId?: ModeId;
  /** Workspace-relative plan path for Orchestrate mode (documentation/plans/*.md). */
  orchestratePlanPath?: string;
  /** Reef widget LLM provider override (Reef mode callLLM). */
  reefWidgetProviderId?: string;
  /** Reef widget LLM model override; empty = chat default. */
  reefWidgetModelId?: string;
  /** Expert auto/manual selection (Step 06). */
  expertSelection?: ExpertSelection;
  /** Last auto-routed expert id (UI hint / debug). */
  lastResolvedExpertId?: string | null;
  /** Active Work Agent; null = default / auto from mode (Step 08). */
  workAgentId?: string | null;
  /** When true, mode switch picks defaultForModes agent (Step 08). */
  workAgentAuto?: boolean;
  /** UI Designer plan vs implement (Step 15); default plan. */
  uiDesignerMode?: 'plan' | 'implement';
  /** Per-chat terminal command history (Step 10). */
  terminalHistory?: TerminalRunRecord[];
  /** Settled sub-agent transcripts keyed per chat (Step 09 + visibility). */
  subAgentRuns?: PersistedSubAgentRun[];
  /** Orchestrate board state (Kanban + waves); Orchestrate mode only. */
  orchestrateBoard?: OrchestrateBoardState;
  /** Chat vs Board rendering for Orchestrate (default implicit chat). */
  viewMode?: 'chat' | 'board';
  /** Backend-owned generation id for in-flight main chat completion (reload re-subscribe). */
  currentGenerationId?: string;
  /** Sidebar: green dot on inactive rows until the user opens this chat again. */
  unread?: boolean;
  /** Epoch ms of last assistant message committed while this chat was active (unread baseline). */
  lastAssistantAt?: number;
  history: Message[];
  lastStats: LastStats | null;
  modelInfo: ModelInfo;
  /** Epoch ms of last committed user/assistant/tool history entry (sidebar sort). */
  lastMessageAt?: number;
  /** Epoch ms of last session metadata touch (prune, legacy fallback for sort). */
  updatedAt: number;
}

export interface SessionState {
  version: SessionSchemaVersion;
  activeId: string | null;
  sidebarCollapsed: boolean;
  chats: Chat[];
  /** Last selected chat per normalized workspace key ('' = unassigned bucket). */
  lastActiveChatIdByWorkspace?: Record<string, string>;
}

/** Built-in system prompt template for the settings drawer. */
export interface SystemPromptPreset {
  id: string;
  label: string;
  text: string;
}

/** `localStorage` payload under `minnow.systemPrompt`. */
export interface SystemPromptSettings {
  presetId: string;
  text: string;
}

/** One model row from `GET /api/v0/models` (cached in `modelCache`). */
export interface LmModelRecord {
  id: string;
  type?: string;
  state?: string;
  quantization?: string;
  arch?: string;
  max_context_length?: number;
}

export interface LmModelsListResponse {
  data?: LmModelRecord[];
}

/** Outbound chat message (system prompt is not persisted in session history). */
export type ApiMessage =
  | ApiSystemMessage
  | ApiUserMessage
  | ApiAssistantMessage
  | ApiToolMessage;

export interface ChatCompletionsRequest {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  stream: boolean;
  stream_options?: { include_usage: boolean };
}

export interface ChatCompletionChoiceDelta {
  content?: string;
  /** LM Studio 0.3.23+ (gpt-oss / o3-mini style). */
  reasoning?: string;
  /** LM Studio experimental DeepSeek-style separate reasoning field. */
  reasoning_content?: string;
  tool_calls?: ChatCompletionToolCallDelta[];
}

export interface ChatCompletionChoice {
  delta?: ChatCompletionChoiceDelta;
  message?: {
    content?: string;
    reasoning?: string;
    reasoning_content?: string;
  };
  finish_reason?: string | null;
}

/** Single SSE `data:` JSON object from `/api/v0/chat/completions`. */
export interface ChatCompletionChunk {
  choices?: ChatCompletionChoice[];
  stats?: Stats;
  usage?: Usage;
  model_info?: ModelInfo;
  model?: string;
}

/** Partial tool calls keyed by stream `index` while merging SSE deltas. */
export type ToolCallAccumulator = Record<number, Partial<ToolCall>>;

/** Accumulator while parsing a streaming completion (`mergeStreamMeta`). */
export interface StreamMeta {
  stats?: Stats;
  usage?: Usage;
  model_info?: ModelInfo;
  model?: string;
  finish_reason?: string;
}

/** Result of `finalizeResponseMeta` before pushing assistant history. */
export interface FinalizedResponseMeta {
  stats: Stats;
  usage: Usage;
  model_info: ModelInfo;
}
