/**
 * Shared data shapes for sessions, LM Studio API payloads, and UI metrics.
 * Mirrors structures in `scripts/_extracted-app.js` / legacy `index.html`.
 */

/** Persisted session blob schema version (`speedchat-sessions-v1`). */
export const SESSION_SCHEMA_VERSION = 1 as const;

export type SessionSchemaVersion = typeof SESSION_SCHEMA_VERSION;

/** Roles stored in chat history (UI + localStorage). */
export type ChatRole = 'user' | 'assistant';

/** Roles sent to LM Studio chat completions (includes ephemeral system prompt). */
export type ApiChatRole = 'system' | ChatRole;

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
  stats?: Stats;
  usage?: Usage;
}

export type Message = UserMessage | AssistantMessage;

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

export interface Chat {
  id: string;
  name: string;
  modelId: string;
  history: Message[];
  lastStats: LastStats | null;
  modelInfo: ModelInfo;
  updatedAt: number;
}

export interface SessionState {
  version: SessionSchemaVersion;
  activeId: string | null;
  sidebarCollapsed: boolean;
  chats: Chat[];
}

/** Built-in system prompt template for the settings drawer. */
export interface SystemPromptPreset {
  id: string;
  label: string;
  text: string;
}

/** `localStorage` payload under `speedchat.systemPrompt`. */
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
export interface ApiMessage {
  role: ApiChatRole;
  content: string;
}

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
}

export interface ChatCompletionChoice {
  delta?: ChatCompletionChoiceDelta;
  message?: { content?: string };
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
