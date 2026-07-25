/**
 * Shared data shapes for sessions, LM Studio API payloads, and UI metrics.
 * Mirrors structures in `documentation/archive/_extracted-app.js` (historical) / legacy `index.html`.
 */

import type { ModeId } from './chat/modes/types';
import type { SuperPlanStageId, SuperPlanState } from './chat/super-plan/types';
import type { PinnedSkillState } from './skills/types';
import type { ChatTokenLedger } from './usage/types';
import type {
  SubAgentBudgetEvent,
  SubAgentStructuredOutcome,
} from './agents/sub-agent-structured-outcome';
import type { ThinkingResolvedMode, ThinkingTriState } from './agents/thinking-types';

/** Per-model / per-chat reasoning effort level for header dropdown and send path. */
export type ReasoningEffortOption = 'off' | 'on' | 'low' | 'medium' | 'high';

/** Persisted session blob schema version (`minnow-sessions-v1` key; version inside JSON). */
export const SESSION_SCHEMA_VERSION = 6 as const;

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
  /** True when the row records a satisfied /goal completion condition. */
  goalAchieved?: boolean;
  /** Super Plan controller stage prompt — hidden from the chat transcript UI. */
  superPlanStage?: SuperPlanStageId;
  /** Programmatic resume prompt (sub-agent completion, onboarding kickoff, etc.). */
  hiddenFromTranscript?: boolean;
}

/** One build-agent progress item (todo_write). */
export interface ChatTodo {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Persistent /goal loop state on a chat (Claude Code–style completion condition). */
export interface ActiveGoalState {
  /** Completion condition text (max 4000 chars). */
  conditionText: string;
  startedAt: number;
  /** Evaluator passes after each goal-driven turn (display only). */
  turnCount: number;
  /** Ledger total at goal start — for "tokens since goal" display. */
  tokenBaseline: number;
  /** Evaluator rationale from the most recent pass. */
  lastReason?: string;
  /** Set when the evaluator confirms the condition; cleared via /goal clear. */
  achieved?: boolean;
}

/**
 * Persistent /loop timer on a chat (session-scoped repeating prompt).
 * Distinct from {@link ActiveGoalState} and from `src/tools/loop.ts` (tool-call loop).
 */
export interface ActiveLoopState {
  /** Per-chat counter for loop panel stop controls. */
  id: number;
  /** Raw prompt including slash skills; empty string = maintenance loop. */
  promptText: string;
  kind: 'interval' | 'auto';
  /** Fixed interval when kind is interval. */
  intervalMs?: number;
  /** Self-paced delay when kind is auto; clamped [60_000, 3_600_000]. */
  currentDelayMs?: number;
  /** Epoch ms of next fire (persisted so reload/sleep survive). */
  dueAt: number;
  createdAt: number;
  /** createdAt + 7 days. */
  expiresAt: number;
  runCount: number;
  /** Auto-pacing comparison digest of last assistant output. */
  lastOutputDigest?: string;
  /** When true, ticker skips until resumed from the loop panel. */
  paused?: boolean;
  /** Ms until next fire, frozen while paused. */
  pausedRemainingMs?: number;
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
  /** Reasoning segments shown in UI; replayed to Anthropic when signature is set. */
  thinking?: string[];
  /** Accumulated reasoning-active wall time for this tool-call reply (ms), not TTFT. */
  thinkingDurationMs?: number;
  /**
   * Anthropic extended-thinking signature for this turn (required to replay tool_use
   * blocks when thinking stays enabled on follow-up Messages API requests.
   */
  thinkingSignature?: string;
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

/** How line stats were produced (UI tooltips / backfill accuracy). */
export type CodeChangeSource =
  | 'file-tool'
  | 'git-commit'
  | 'command-snapshot'
  | 'command-heuristic'
  | 'backfill';

/** Unified diff line for tool expando (matches prompt diff renderer). */
export interface CodeChangeDiffLine {
  type: 'unchanged' | 'add' | 'remove';
  text: string;
}

/** Per mutation tool: line adds/deletes (GitHub-style) plus optional diff body. */
export interface CodeChangeStats {
  additions: number;
  deletions: number;
  path?: string;
  paths?: string[];
  source?: CodeChangeSource;
  diffLines?: CodeChangeDiffLine[];
  diffTruncated?: boolean;
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
  /** Outbound reasoning text for Anthropic tool-loop replay (not persisted in session). */
  reasoning?: string;
  /** DeepSeek thinking-mode replay on tool-loop turns (OpenCode Go / api.deepseek.com). */
  reasoning_content?: string;
  /** Anthropic thinking signature paired with `reasoning` for Messages API replay. */
  reasoning_signature?: string;
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

/** @deprecated Migrated to chat.expertId — hydrated for legacy sessions only. */
export interface ExpertSelection {
  mode: 'auto' | 'manual';
  expertId: string | null;
}

/** Re-export for chat runtime snapshot typing. */
export type { ExpertRuntimeSnapshot } from './chat/experts/types';

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
  | 'merging'
  | 'complete'
  | 'failed'
  | 'blocked'
  | 'quarantined';

/** Sub-agent category for board agent grid styling. */
export type BoardCategory = 'build' | 'fix' | 'test' | 'research';

/** Structured agent→board report (board_report tool). */
export interface BoardReport {
  outcome: 'pass' | 'fail' | 'env_blocked';
  summary: string;
  blockers?: string[];
}

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
  /** Task ids that must reach 'complete' before this task is ready; omit when none. */
  dependsOn?: string[];
  /** Linked Tester chat session id (per-task testing). */
  testChatId?: string;
  /**
   * Linked fixer chat. Two flavours, discriminated by {@link fixerKind}:
   *  - 'merge' (default) — merge-conflict fixer, runs in the integration worktree.
   *  - 'env'  — environment/setup fixer, runs in the task's own worktree to
   *             repair infra failures (missing deps, unstarted services) so AFK
   *             can self-heal instead of dead-ending at quarantine.
   */
  fixerChatId?: string;
  /** Which kind of fixer {@link fixerChatId} is. Absent ⇒ legacy merge fixer. */
  fixerKind?: 'merge' | 'env';
  /** Env-fixer attempts (0 = first try). Bounds the infra self-heal loop. */
  envFixAttempts?: number;
  /** Phase to re-run after an env-fixer finishes ('build' or 'test'). */
  envFixPhase?: 'build' | 'test';
  /** Build↔test retry count (incremented on each test failure). */
  testAttempts?: number;
  /** Build-failure retry count (incremented on each failed build chat in auto/afk). */
  buildAttempts?: number;
  /** Merge-conflict fixer attempts (0 = first try, 1 = one retry used). */
  fixerAttempts?: number;
  /** Bounded retry counter when a build chat ends stopped (timeout/system). */
  stopRetries?: number;
  /** Pre-merge integration tip SHA for restore on fixer failure. */
  mergePreSha?: string;
  /** Unified structured report from board_report (stream-end routing). */
  boardReport?: BoardReport;
  /** Structured verdict from board_report_test_result (stream-end routing). */
  testVerdict?: 'pass' | 'fail';
  /** Human summary from the Tester (shown on fail / blocked). */
  testSummary?: string;
  /** Snapshot of the last cleared failure, for the collapsed "previous failure" link. */
  prevFailure?: {
    error?: string;
    testSummary?: string;
    testVerdict?: 'pass' | 'fail';
    at: number;
  };
  /** Quarantine payload — set when task is moved to `quarantined`. */
  quarantine?: {
    category: 'infra' | 'code' | 'merge' | 'stall' | 'unknown';
    summary: string;
    resolutionSteps: string[];
    at: number;
    logRef?: string;
  };
  /** Phase-2 placeholder: self-heal iteration counter. */
  selfHealRound?: number;
  /** Monotonic lifecycle counter bumped on requeue so completion reports dedupe per run. */
  lifecycleRun?: number;
  /** Phase-2 placeholder: category of the last self-heal attempt. */
  lastHealCategory?: string;
  /** Phase-2 placeholder: outcome of the last build attempt. */
  buildOutcome?: 'success' | 'failure' | 'skipped' | string;
  /** Phase-2: structured blockers reported by board_report_build_result. */
  buildBlockers?: string[];
  /**
   * Pending Builder seed (failure-aware retry/reopen prompt) to use on the next
   * build start instead of the default task seed. Persisted on the task so it
   * survives being queued for a concurrency slot; consumed and cleared by
   * startTask when the build actually launches.
   */
  pendingBuildSeed?: string;
  /**
   * Absolute path to this task's git worktree when board isolation is active
   * (MIN-275). Unset when isolation is `off` or the worktree has been cleaned up.
   */
  worktreePath?: string;
  /** Git branch backing {@link worktreePath} (per-task, or the shared per-wave branch). */
  worktreeBranch?: string;
  /** Vite client port allocated to this task's isolated worktree (avoids port collisions). */
  devPort?: number;
  /** Express/API server port paired with {@link devPort} for fullstack scaffolds. */
  apiPort?: number;
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

/** A task that could not be resolved by the self-heal loop — feeds the MIN-208 finish dashboard. */
export interface UnresolvedIssue {
  taskId: string;
  title: string;
  category: 'infra' | 'code' | 'merge' | 'stall';
  summary: string;
  resolutionSteps: string[];
  logRef?: string;
  createdAt: number;
  attempts?: number;
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
  /** Manual board vs auto-pilot delegation (default manual). */
  executionMode?: 'manual' | 'auto' | 'sequential' | 'afk';
  /** True when the user has pressed Start in auto/sequential mode. */
  autoRunning?: boolean;
  /** Orchestrator requested AFK via board_set_autonomy; awaits user confirmation. */
  pendingAfk?: boolean;
  /**
   * True when the user pressed Stop on the board. Freezes the header timer
   * immediately and surfaces the Stopped status regardless of lagging task
   * statuses. Cleared when the user starts execution again.
   */
  userStopped?: boolean;
  /**
   * True when auto-run was paused by shutdown or OOM recovery (not user Stop).
   * Stream-end finalization treats this as a system stop (planned + stopRetries),
   * not quarantine. Cleared when the user starts execution again.
   */
  systemPaused?: boolean;
  /**
   * Filesystem/process isolation for parallel tasks (MIN-275). When unset it is
   * resolved from {@link executionMode} (sequential/manual → off, auto/afk → per-task).
   */
  isolationMode?: 'off' | 'per-task' | 'per-wave';
  /** Board integration branch that task/wave branches merge into; minted at first isolated start. */
  integrationBranch?: string;
  /** Base branch/commit the integration branch was created from (cleanup/reset reference). */
  isolationBaseRef?: string;
  /** Epoch ms when plan-complete UI was shown (dedupe). */
  completionShownAt?: number;
  /** True when every task is quarantined and none completed (terminal blocked state). */
  terminalBlocked?: boolean;
  /** Plan-complete wrap-up turn deferred until planner stream ends. */
  wrapUpPending?: boolean;
  /** User dismissed the finish dashboard to view the kanban again. */
  dashboardDismissed?: boolean;
  /** Epoch ms when integration was merged into the workspace and committed (finish dashboard). */
  integrationLandedAt?: number;
  /** Epoch ms when the user cleared all board git worktrees from the finish dashboard. */
  worktreesClearedAt?: number;
  /** Cached markdown finish report (summary, next steps, how-to-run). */
  finishReport?: string;
  /** Full-board integration test after all tasks complete. */
  finalTest?: {
    status: 'pending' | 'in_progress' | 'passed' | 'failed';
    chatId?: string;
    attempts?: number;
    recordedVerdict?: 'pass' | 'fail';
    failingTaskIds?: string[];
    summary?: string;
  };
  /** Chronological diagnostic log, capped ring buffer (oldest dropped). */
  log?: BoardLogEvent[];
  /** Phase-2 placeholder: provisioning lifecycle for AFK workspace setup. */
  provisionState?: 'idle' | 'provisioning' | 'ready' | 'failed';
  /** Phase-2 placeholder: content-hash signatures of provisioned artefacts. */
  provisionedSignatures?: string[];
  /** Structured per-task unresolved issues — data source for the MIN-208 finish dashboard. */
  unresolvedIssues?: UnresolvedIssue[];
}

export type BoardLogLevel = 'info' | 'warn' | 'error';

export type BoardLogEventType =
  | 'board_init'
  | 'mode_change'
  | 'auto_start'
  | 'auto_stop'
  | 'task_status'
  | 'task_started'
  | 'build_verdict'
  | 'test_verdict'
  | 'merge_result'
  | 'worktree_allocated'
  | 'task_retry'
  | 'task_error'
  | 'tool_call'
  | 'terminal_run'
  | 'dev_server'
  | 'final_test_started'
  | 'final_test_verdict';

export interface BoardLogEvent {
  id: string;
  ts: number;
  type: BoardLogEventType;
  level: BoardLogLevel;
  taskId?: string;
  message: string;
  detail?: BoardLogDetail;
}

export interface BoardLogDetail {
  from?: BoardTaskStatus;
  to?: BoardTaskStatus;
  verdict?: 'pass' | 'fail';
  attempt?: number;
  attemptKind?: 'build' | 'test' | 'fixer';
  mode?: 'manual' | 'auto' | 'sequential' | 'afk';
  outcome?: 'merged' | 'conflict' | 'error' | 'skipped';
  branch?: string;
  devPort?: number;
  apiPort?: number;
  toolName?: string;
  argsPreview?: string;
  resultPreview?: string;
  command?: string;
  exitCode?: number;
  runId?: string;
  chatId?: string;
  error?: string;
  summary?: string;
  failingTaskIds?: string[];
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
  /** Resolved reasoning effort frozen for replay (when dropdown applies). */
  reasoningEffort?: ReasoningEffortOption;
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
  /** @deprecated Ignored; retained for replay of older turn snapshots. */
  maxToolTurns?: number;
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

/** Why a turn run ended with status `stopped` (user Stop vs timeout vs supervision). */
export type ChatStopReason = 'user' | 'timeout' | 'system';

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
  /** Set when {@link status} is `stopped` — who/what aborted the turn. */
  stopReason?: ChatStopReason;
  /** Set when the turn ended because it hit a hard cap rather than finishing normally. */
  endReason?: 'max_tool_turns';
  /** User-facing failure detail when {@link status} is `failed` (survives history rollback). */
  errorMessage?: string;
}

/** Expert thread or legacy Expert Lab session (hidden from main sidebar). */
export type ChatKind = 'expert' | 'expert-lab';

/** MinnowOS app-owned chat scopes that stay out of unrelated session rails. */
export type ChatAppScope = 'email';

/** Follow-up message queued while the agent turn is in progress (MIN-200). */
export interface QueuedComposerMessage {
  id: string;
  text: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  name: string;
  /** expert = per-expert thread; expert-lab = legacy hidden session (migrated away). */
  kind?: ChatKind;
  /** App-owned conversation scope, separate from Code, Desktop, and Chat rails. */
  appScope?: ChatAppScope;
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
  /** @deprecated Legacy picker — use expertId on expert chats. */
  expertSelection?: ExpertSelection;
  /** Frozen runtime profile applied when this expert chat was created. */
  expertRuntime?: import('./chat/experts/types').ExpertRuntimeSnapshot;
  /** Tri-state thinking override for this chat (inherit uses work-agent / global stack). */
  thinkingMode?: ThinkingTriState;
  /** Per-chat reasoning effort override; unset resolves from catalog default + inherit stack. */
  reasoningEffort?: ReasoningEffortOption;
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
  /**
   * Per-request tool workspace root override (MIN-275). When set, this chat's tool
   * calls run scoped to this absolute path (its git worktree) instead of the global
   * Code workspace, isolating concurrent board task chats. Unset = shared workspace.
   */
  worktreeRoot?: string;
  /**
   * Git branch this chat operates on (MIN-276 composer branch selector). When
   * {@link worktreeRoot} is set, this is the worktree branch; otherwise the
   * workspace checkout branch the chat targets.
   */
  gitBranch?: string;
  /**
   * True when Minnow created the chat worktree at the managed slot (cleanup on
   * delete / detach to Local). False when attached to an existing worktree.
   */
  chatWorktreeManaged?: boolean;
  /** @deprecated Migrated to ~/.minnow/bugs/state.json — stripped on load. */
  bugBoard?: BugBoardState;
  /**
   * @deprecated Board view mode lives on {@link ChatGroup}; stripped on load after migration.
   */
  viewMode?: 'chat' | 'board';
  /** Backend-owned generation id for in-flight main chat completion (reload re-subscribe). */
  currentGenerationId?: string;
  /** Queued steering correction for the in-flight turn (push-now; cleared on consume or stop). */
  pendingSteerMessage?: string;
  /** Follow-up messages queued while this chat is streaming (MIN-200). */
  pendingMessageQueue?: QueuedComposerMessage[];
  /** Active /goal completion loop; persists across reload until cleared. */
  activeGoal?: ActiveGoalState;
  /** Active /loop timers; persists across reload until stopped or expired (7 days). */
  activeLoops?: ActiveLoopState[];
  /** Next per-chat /loop id (monotonic). */
  nextLoopId?: number;
  /** Super Plan pipeline controller state (Plan mode overhaul Phase 3). */
  superPlan?: SuperPlanState;
  /** Build-agent progress checklist (todo_write); replace-all, cleared on /clear. */
  todos?: ChatTodo[];
  /** Epoch ms when todos were last written via todo_write. */
  todosUpdatedAt?: number;
  /** Queued mode switch from set_chat_mode during streaming (last write wins; flushed on stream end). */
  pendingModeId?: ModeId;
  /** Sidebar: green dot on inactive rows until the user opens this chat again. */
  unread?: boolean;
  /** Sidebar: red dot on inactive rows after a failed turn until the user opens this chat again. */
  turnError?: boolean;
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
  /** Unsent composer text shown as a draft row in the sidebar until the first send. */
  composerDraft?: string;
  /** Sticky slash skill for this chat (persists until cleared or replaced). */
  pinnedSkill?: PinnedSkillState | null;
  /** Pending user edits from Reef widgets; consumed on next send. */
  pendingReefArtifactEdits?: ReefArtifactEditEvent[];
  /** Artifact ids bound to this chat (sidebar / history hints). */
  reefArtifactIds?: string[];
  /** Cumulative token usage and optional USD cost (Feature #14). */
  tokenLedger?: ChatTokenLedger;
  /** Cumulative line add/delete from agent mutations in this chat. */
  codeChangeTotals?: ChatCodeChangeTotals;
  /** Epoch ms when history backfill last rebuilt codeChangeTotals. */
  codeChangeBackfillAt?: number;
  /** Last archive policy trim stats (MIN-139). */
  lastContextTrim?: {
    archived?: number;
    recalled?: number;
    recallTokens?: number;
  };
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
  /** Expanded chat sidebar width in px (persisted). */
  sidebarWidth?: number;
  chats: Chat[];
  /** Collapsible chat folders per workspace. */
  groups?: ChatGroup[];
  /** Folder whose board fills #chatArea when viewMode is board. */
  activeBoardGroupId?: string;
  /** Last selected chat per normalized workspace key ('' = unassigned bucket). */
  lastActiveChatIdByWorkspace?: Record<string, string>;
  /** Last selected chat per MinnowOS app id (e.g. `{ chat: '…' }` for the Chat app). */
  lastActiveChatIdByApp?: Record<string, string>;
  /** Cumulative agent line stats keyed by normalized workspace path. */
  codeChangeTotalsByWorkspace?: Record<string, ChatCodeChangeTotals>;
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
  /** Catalog `reasoning.allowed_options` when upstream exposes effort control. */
  reasoningAllowedOptions?: ReasoningEffortOption[];
  /** Catalog default reasoning effort when provided. */
  reasoningDefault?: ReasoningEffortOption;
  /** Value to send for `thinking.type` when enabled on openai-v1 providers (defaults to 'enabled'). MiniMax requires 'adaptive'. */
  reasoningThinkingEnabledValue?: 'enabled' | 'adaptive';
  contextLength: number | null;
  loadState: string | null;
  /** Resolved upstream API for this model (gateway auto-routing). */
  api?: import('./providers/types').ApiKind;
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
  /** Resolved upstream API (`openai-v1` vs `anthropic-v1`) for mixed gateways. */
  api?: import('./providers/types').ApiKind;
  /** OpenAI-compatible catalog owner when present (e.g. OpenRouter `owned_by`). */
  owned_by?: string;
  family?: string;
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
  /** Some Ollama-compatible gateways (e.g. MiniMax) emit thinking in this field. */
  thinking?: string;
  /** Anthropic extended-thinking signature (Minnow anthropic-v1 bridge extension). */
  reasoning_signature?: string;
  tool_calls?: ChatCompletionToolCallDelta[];
}

export interface ChatCompletionChoice {
  delta?: ChatCompletionChoiceDelta;
  message?: {
    content?: string;
    /** OpenAI structured-output JSON when `content` is empty. */
    parsed?: unknown;
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
