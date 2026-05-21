/**
 * Default persisted payloads when home dir or localStorage is empty.
 */

import { SYSTEM_PROMPT_PRESETS } from '../constants';
import { BUILT_IN_TOOLS } from '../tools/definitions';
import type { ToolConfig, ToolPermissionMode } from '../tools/tool-settings-types';
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
]);

/** Tools that default to full permission (no approval strip before running). */
export const DEFAULT_FULL_PERMISSION_TOOL_IDS = new Set([
  'ask_question',
  'set_chat_mode',
  'create_chat_with_mode',
  'propose_mode_switch',
]);

/** Default tool toggles for new `tools.json` (matches server seed). */
export function defaultToolConfig(): ToolConfig {
  const enabled: Record<string, boolean> = {};
  const permissions: Record<string, ToolPermissionMode> = {};
  for (const tool of BUILT_IN_TOOLS) {
    const on = DEFAULT_ENABLED_TOOL_IDS.has(tool.id);
    enabled[tool.id] = on;
    permissions[tool.id] = DEFAULT_FULL_PERMISSION_TOOL_IDS.has(tool.id)
      ? 'full'
      : on
        ? 'ask'
        : 'off';
  }
  return { enabled, permissions, keys: { braveApiKey: '' } };
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
  const chatId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : '00000000-0000-0000-0000-000000000001';

  return {
    version: 2,
    activeId: chatId,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
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
