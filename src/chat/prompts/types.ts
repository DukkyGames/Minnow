/**
 * Shared types for the programmatic prompt system (Step 04).
 */

/** Global prompt profile — drives body selection and lite rules. */
export type PromptProfile = 'full' | 'lite' | 'custom';

/** Composer part identifiers (concatenation order is fixed in prompt-composer). */
export type PromptPartId =
  | 'base'
  | 'mode'
  | 'expert'
  | 'tool-usage'
  | 'info'
  | 'memory'
  | 'work-agent'
  | 'skill';

/** Parsed prompt template kind from front matter. */
export type PromptKind =
  | 'base'
  | 'mode'
  | 'expert'
  | 'tool-usage'
  | 'info'
  | 'work-agent'
  | 'title';

/** YAML front matter on a shipped or user prompt file. */
export interface PromptFrontMatter {
  id: string;
  kind: PromptKind;
  label: string;
  version: number;
  description?: string;
  part?: PromptPartId;
  modeBindings?: string[];
  expertTriggers?: string[];
  toolPolicy?: string;
  body?: string;
  fullBody?: string;
  liteBody?: string;
  defaultProfile?: PromptProfile;
}

/** Loaded prompt record after parsing a markdown file. */
export interface ParsedPrompt {
  id: string;
  kind: PromptKind;
  part: PromptPartId;
  label: string;
  version: number;
  description?: string;
  /** Resolved body for the active profile before interpolation. */
  body: string;
  relativePath: string;
  source: 'builtin' | 'user';
}

/** Per-part settings inside a custom prompt configuration. */
export interface PromptConfigPartSettings {
  enabled: boolean;
  contentOverride: string | null;
}

/** Named custom profile stored under ~/.speedchat/prompt-configs/. */
export interface PromptConfig {
  id: string;
  label: string;
  profile: 'custom';
  parts: Partial<Record<PromptPartId, PromptConfigPartSettings>>;
  meta?: {
    createdAt?: string;
    updatedAt?: string;
  };
}

/** Runtime inputs for composeSystemPrompt. */
export interface ComposeContext {
  profile: PromptProfile;
  customConfigId?: string | null;
  customConfig?: PromptConfig | null;
  cwd: string;
  modeId: string | null;
  expertId: string | null;
  workAgentId: string | null;
  skillBody: string | null;
  memoryBlock: string | null;
  enabledToolIds: string[];
  enabledToolSummaries?: string;
  infoPresetId: string | null;
  userMessagePreview?: string;
  includeChatHistorySummary?: boolean;
}

/** Tokens replaced in composed bodies via interpolate.ts. */
export interface InterpolationVars {
  mode: string;
  expert: string;
  enabled_tools: string;
  cwd: string;
  memory: string;
  user_message: string;
  chat_history_summary: string;
  work_agent: string;
  skill: string;
  date: string;
  os: string;
}

/** List entry returned by GET /api/prompt-configs. */
export interface PromptConfigListItem {
  id: string;
  label: string;
}
