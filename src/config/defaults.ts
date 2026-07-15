/**
 * Default persisted payloads when home dir or localStorage is empty.
 */

import { SYSTEM_PROMPT_PRESETS } from '../constants';
import { randomUUID } from '../lib/random-id.ts';
import { BUILT_IN_TOOLS } from '../tools/definitions';
import {
  createEmptyToolPermissionsConfig,
  type ToolConfig,
  type ToolPermissionMode,
} from '../tools/tool-settings-types';
import type { SessionState, SystemPromptSettings } from '../types';
import { defaultSkillConfig as buildDefaultSkillConfig } from '../skills/config';
import type { SkillConfig } from '../skills/config';
import type { UserRulesSettings } from './user-rules';

/** Default skill toggles (all enabled). */
export function defaultSkillConfig(): SkillConfig {
  return buildDefaultSkillConfig();
}

const DEFAULT_ENABLED_TOOL_IDS = new Set([
  'get_datetime',
  'calculate',
  'web_search',
  'wikipedia_search',
  'save_memory',
  'ask_question',
  'set_chat_mode',
  'create_chat_with_mode',
  'propose_mode_switch',
  'launch_minnow_app',
  'brain_search',
  'brain_read_page',
  'brain_list',
  'brain_write_page',
  'brain_append_log',
  'brain_ingest_source',
  'manage_brain',
  'search_settings',
  'get_settings',
  'update_settings',
  'get_appearance',
  'update_appearance',
  'upload_appearance_asset',
  'repo_map',
  'find_symbol',
  'who_calls',
  'read_symbol',
  'explain_symbol',
  'read_file',
  'todo_write',
]);

/** Brain tools default to permission `full` (no prompt). */
const BRAIN_FULL_PERMISSION_TOOL_IDS = [
  'brain_search',
  'brain_read_page',
  'brain_list',
  'brain_write_page',
  'brain_append_log',
  'brain_ingest_source',
  'save_memory',
  'repo_map',
  'find_symbol',
  'who_calls',
  'read_symbol',
  'explain_symbol',
] as const;

const BRAIN_FULL_PERMISSION_TOOL_ID_SET = new Set<string>(BRAIN_FULL_PERMISSION_TOOL_IDS);

/** Settings read tools default to permission `full`. */
const SETTINGS_READ_TOOL_IDS = new Set(['search_settings', 'get_settings']);

/** Appearance read tool defaults to permission `full`. */
const APPEARANCE_READ_TOOL_IDS = new Set(['get_appearance']);

function defaultPermissionForTool(id: string, enabled: boolean): ToolPermissionMode {
  if (SETTINGS_READ_TOOL_IDS.has(id) || APPEARANCE_READ_TOOL_IDS.has(id)) {
    return enabled ? 'full' : 'off';
  }
  if (BRAIN_FULL_PERMISSION_TOOL_ID_SET.has(id)) {
    return enabled ? 'full' : 'off';
  }
  return enabled ? 'ask' : 'off';
}

/** Default tool toggles for new `tools.json` (matches server seed). */
export function defaultToolConfig(): ToolConfig {
  const enabled: Record<string, boolean> = {};
  const permissions = createEmptyToolPermissionsConfig();
  for (const tool of BUILT_IN_TOOLS) {
    const on = DEFAULT_ENABLED_TOOL_IDS.has(tool.id);
    enabled[tool.id] = on;
    permissions.default[tool.id] = defaultPermissionForTool(tool.id, on);
  }
  return {
    enabled,
    permissions,
    keys: { braveApiKey: '', tavilyApiKey: '' },
    webSearchProvider: 'duckduckgo',
    toolCache: { enabled: true },
  };
}

/** Default ~/.minnow/rules.json contents. */
export function defaultUserRulesSettings(): UserRulesSettings {
  return { version: 1, enabled: false, text: '' };
}

/** Default system prompt file contents. */
export function defaultSystemPromptSettings(): SystemPromptSettings {
  const preset = SYSTEM_PROMPT_PRESETS.find((p) => p.id === 'general-assistant');
  return {
    presetId: 'general-assistant',
    text: preset?.text ?? 'You are a helpful, concise assistant.',
  };
}

/** One empty chat session blob. */
export function defaultSessionState(): SessionState {
  const chatId = randomUUID();

  return {
    version: 5,
    groups: [],
    activeId: chatId,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    lastActiveChatIdByApp: {},
    chats: [
      {
        id: chatId,
        name: 'New chat',
        workspacePath: '',
        modelId: '',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    ],
  };
}
