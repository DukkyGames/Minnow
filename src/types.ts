/**
 * Shared data shapes for sessions, LM Studio API payloads, and UI metrics.
 * Mirrors structures in `documentation/archive/_extracted-app.js` (historical) / legacy `index.html`.
 */

import type { ModeId } from './chat/modes/types';
import type { PinnedSkillState } from './skills/types';
import type { ChatTokenLedger } from './usage/types';
import type {
  SubAgentBudgetEvent,
  SubAgentStructuredOutcome,
} from './agents/sub-agent-structured-outcome';
import type { ThinkingResolvedMode, ThinkingTriState } from './agents/thinking-types';

/** Persisted session blob schema version (`minnow-sessions-v1` key; version inside JSON). */
export const SESSION_SCHEMA_VERSION = 5 as const;

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
  /** True when the row was injected via steer consume (interrupt-and-steer). */
  steer?: boolean;
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

/** Per file-mutation tool: line adds/deletes (GitHub-style). */
export interface CodeChangeStats {
  additions: number;
  deletions: number;
  path?: string;
}

/** Cumulative line stats for one chat (file-write tools only). */
export interface ChatCodeChangeTotals {
  additions: number;
  deletions: number;
}

/** Tool execution result correlated to `tool_call_id` from the prior assistant turn. */
export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
  attachments?: ToolImageAttachment[];
  codeChange?: CodeChangeStats;
}

/** Result returned from executeTool (text + optional UI attachments). */
export interface ToolExecutionResult {
  content: string;
  attachments?: ToolImageAttachment[];
  codeChange?: CodeChangeStats;
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
  /** Structured handoff for drawer restore (MIN-43). */
  structuredOutcome?: SubAgentStructuredOutcome;
  budgetEvents?: SubAgentBudgetEvent[];
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
  /** Latest settled sub-agent run (kept after assignedRunId is cleared). */
  lastRunId?: string;
  /** All sub-agent run ids spawned for this task (newest last). */
  runHistory?: string[];
  startedAt?: number;
  endedAt?: number;
  filesChanged?: number;
  notes?: string;
  error?: string;
  /** Linked task chat session id. */
  chatId?: string;
  /** Build spec from plan parse (display + task-chat seed). */
  buildSpec?: string;
  /** Test spec from plan parse (display + task-chat seed). */
  testSpec?: string;
}

/** Wave rollup row (status derived from tasks). */
export interface BoardWave {
  id: number | string;
  status: BoardTaskStatus;
  taskCount?: number;
  completeCount?: number;
  /** When true, the wave's kanban lanes are hidden in board view. */
  collapsed?: boolean;
}

/** Structured Orchestrate plan execution state (persisted on chat). */
export interface OrchestrateBoardState {
  planPath: string;
  tasks: BoardTask[];
  waves: BoardWave[];
  startedAt: number;
  lastUpdatedAt: number;
  /** Ms accumulated while orchestration is actively running (pauses when idle/stopped). */
  timerAccumulatedMs?: number;
  /** Epoch ms when the current run segment started; unset while the timer is paused. */
  timerSegmentStartedAt?: number;
  /** Parent turn id for Stop orchestrator (minted in tool loop). */
  activeParentTurnId?: string;
  /** Max concurrent task chats (default 3). */
  maxConcurrentTasks?: number;
  /** Epoch ms when plan-complete UI was shown (dedupe). */
  completionShownAt?: number;
}

/** Collapsible sidebar folder for chats in a workspace. */
export interface ChatGroup {
  id: string;
  name: string;
  /** Normalized absolute workspace root; groups are per-workspace. */
  workspacePath: string;
  collapsed: boolean;
  order: number;
  createdAt: number;
  /** Kanban + waves for Orchestrate plans owned by this folder. */
  orchestrateBoard?: OrchestrateBoardState;
  /** Workspace-relative plan path (documentation/plans/*.md). */
  orchestratePlanPath?: string;
  /** Main-column chat vs board rendering for this folder. */
  viewMode?: 'chat' | 'board';
  /** Orchestrate planner chat that parsed the plan / runs board_init. */
  plannerChatId?: string;
}

/** Bug tracker workflow column (MIN-16). */
export type BugColumn =
  | 'reported'
  | 'investigating'
  | 'planned'
  | 'fixing'
  | 'complete';

/** Bug severity for triage. */
export type BugSeverity = 'low' | 'medium' | 'high' | 'critical';

/** One bug card on the global bug tracker Kanban. */
export interface BugCard {
  id: string;
  title: string;
  description: string;
  severity: BugSeverity;
  column: BugColumn;
  /** Workspace folder this bug belongs to. */
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
  /** Investigation / fix chat (created on Investigate). */
  chatId?: string;
  /** Debugger or planner summary notes shown on the card. */
  notes?: string;
  /** Workspace-relative fix plan (documentation/plans/bugs/<id>.md). */
  planPath?: string;
  investigateRunId?: string;
  planRunId?: string;
  /** Linked orchestrate fix run (after Start fix). */
  fixRunId?: string;
}

/** @deprecated Legacy per-chat board; migrated to bugs/state.json. */
export interface BugBoardState {
  bugs: BugCard[];
  startedAt: number;
  lastUpdatedAt: number;
}

/** Stable id for one execution from a fork point (branch). */
export type TurnRunId = string;

/** Snapshot of inputs needed to replay or fork without re-reading UI globals. */
export interface TurnSnapshot {
  /** User row index at fork time (anchor). */
  forkHistoryIndex: number;
  /** Stored user content (includes skill tags). */
  userContent: string;
  /** Parsed skill id when present. */
  skillId: string | null;
  providerId: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  /** Resolved thinking on/off frozen for replay. */
  thinkingMode: ThinkingResolvedMode;
  modeId: ModeId;
  workAgentId: string | null;
  workAgentAuto: boolean;
  expertSelection?: ExpertSelection;
  uiDesignerMode?: 'plan' | 'implement';
  /** Composed system string from resolveOutboundSystemMessages. */
  composedSystemPrompt: string;
  userRulesContent?: string;
  /** Ordered tool function names enabled for this turn. */
  enabledToolNames: string[];
  maxToolTurns: number;
  /** SHA-256 hex of JSON.stringify(apiMessages prefix through fork). */
  historyPrefixHash: string;
  orchestratePlanPath?: string;
}

export type TurnRunStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'superseded';

/** One turn execution from a user-message fork point. */
export interface TurnRunRecord {
  runId: TurnRunId;
  /** One branch id per run (picker labels Branch 1, 2, …). */
  branchId: string;
  forkHistoryIndex: number;
  parentRunId?: TurnRunId;
  status: TurnRunStatus;
  createdAt: number;
  endedAt?: number;
  snapshot: TurnSnapshot;
  /** Inclusive indices in chat.history for assistant/tool rows from this run. */
  outputHistoryStart?: number;
  outputHistoryEnd?: number;
  /** Copy of assistant/tool rows produced by this run (for branch switch after truncate). */
  outputMessages?: Message[];
  generationIds?: string[];
  /** Sub-agent correlation id for this main turn. */
  parentTurnId?: string;
}

/** Expert thread or legacy Expert Lab session (hidden from main sidebar). */
export type ChatKind = 'expert' | 'expert-lab';

export interface Chat {
  id: string;
  name: string;
  /** expert = per-expert thread; expert-lab = legacy hidden session (migrated away). */
  kind?: ChatKind;
  /** Specialist id when kind === 'expert'. */
  expertId?: string;
  /** Normalized absolute workspace root at chat creation; '' = unassigned (legacy). */
  workspacePath: string;
  modelId: string;
  /** Optional per-chat provider override (Step 03). */
  providerId?: string;
  /** Operating mode for prompt + tool policy (Step 05); default build. */
  modeId?: ModeId;
  /** Sidebar group membership (optional). */
  groupId?: string;
  /** Workspace-relative plan path for Orchestrate mode (documentation/plans/*.md). */
  orchestratePlanPath?: string;
  /** Reef widget LLM provider override (Reef mode callLLM). */
  reefWidgetProviderId?: string;
  /** Reef widget LLM model override; empty = chat default. */
  reefWidgetModelId?: string;
  /** Expert auto/manual selection (Step 06). */
  expertSelection?: ExpertSelection;
  /** Tri-state thinking override for this chat (inherit uses work-agent / global stack). */
  thinkingMode?: ThinkingTriState;
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
  /**
   * @deprecated Board state lives on {@link ChatGroup}; stripped on load after v4→v5 migration.
   */
  orchestrateBoard?: OrchestrateBoardState;
  /** Weak link from planner chat to its board folder ({@link ChatGroup.id}). */
  boardGroupId?: string;
  /** Orchestrate board task id when this chat is a per-task worker thread. */
  boardTaskId?: string;
  /** @deprecated Migrated to ~/.minnow/bugs/state.json — stripped on load. */
  bugBoard?: BugBoardState;
  /**
   * @deprecated Board view mode lives on {@link ChatGroup}; stripped on load after migration.
   */
  viewMode?: 'chat' | 'board';
  /** Backend-owned generation id for in-flight main chat completion (reload re-subscribe). */
  currentGenerationId?: string;
  /** Queued steering correction for the in-flight turn (last write wins; cleared on consume or stop). */
  pendingSteerMessage?: string;
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
  /** Turn runs for replay / branch switching (schema v3). */
  runs?: TurnRunRecord[];
  /** forkHistoryIndex (string) → active branchId for the materialized transcript. */
  activeBranchByFork?: Record<string, string>;
  /** Sticky slash skill for this chat (persists until cleared or replaced). */
  pinnedSkill?: PinnedSkillState | null;
  /** Pending user edits from Reef widgets; consumed on next send. */
  pendingReefArtifactEdits?: ReefArtifactEditEvent[];
  /** Artifact ids bound to this chat (sidebar / history hints). */
  reefArtifactIds?: string[];
  /** Cumulative token usage and optional USD cost (Feature #14). */
  tokenLedger?: ChatTokenLedger;
  /** Cumulative line add/delete from file-mutation tools in this chat. */
  codeChangeTotals?: ChatCodeChangeTotals;
}

export type {
  ChatTokenLedger,
  ProviderPricing,
  TokenLedgerBySource,
  TokenLedgerEntry,
  TokenLedgerSource,
  TokenLedgerTotals,
} from './usage/types';

/** User co-edit on a versioned reef artifact (widget bridge). */
export interface ReefArtifactEditEvent {
  artifactId: string;
  version: number;
  summary: string;
  path: string;
  at: string;
}

export interface SessionState {
  version: SessionSchemaVersion;
  activeId: string | null;
  sidebarCollapsed: boolean;
  chats: Chat[];
  /** Collapsible chat folders per workspace. */
  groups?: ChatGroup[];
  /** Folder whose board fills #chatArea when viewMode is board. */
  activeBoardGroupId?: string;
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

/** Provenance for a detected model capability (feature #11). */
export type CapabilitySource = 'catalog' | 'probe' | 'assumed';

/** Per-model capability flags merged from catalog and probe. */
export interface ModelCapabilities {
  vision: boolean | null;
  tools: boolean | null;
  streaming: boolean | null;
  grammar: boolean | null;
  reasoning: boolean | null;
  /** Catalog `reasoning.allowed_options` when upstream exposes tri-state control. */
  reasoningAllowedOptions?: Array<'off' | 'on'>;
  /** Catalog default reasoning mode when provided. */
  reasoningDefault?: 'off' | 'on';
  contextLength: number | null;
  loadState: string | null;
  sources?: Partial<Record<keyof ModelCapabilities | 'loadState', CapabilitySource>>;
  probeErrors?: Record<string, string>;
}

/** One model row from `GET /api/v0/models` (cached in `modelCache`). */
export interface LmModelRecord {
  id: string;
  type?: string;
  state?: string;
  quantization?: string;
  arch?: string;
  /** Catalog / architecture maximum. */
  max_context_length?: number;
  /** Allocated context for a loaded model (LM Studio UI setting). */
  loaded_context_length?: number;
  /** Merged catalog + probe capabilities (feature #11). */
  capabilities?: ModelCapabilities;
  /** LM Studio 0.4.8+ catalog reasoning block when present on models list row. */
  reasoning?: {
    allowed_options?: string[];
    default?: string;
  };
  /** Upstream catalog vision flag (`capabilities.vision` or `type: vlm`) before Minnow merge. */
  catalogVision?: boolean;
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
