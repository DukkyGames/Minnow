/**
 * Default persisted payloads when home dir or localStorage is empty.
 */

import { SYSTEM_PROMPT_PRESETS } from '../constants';
import { BUILT_IN_TOOLS } from '../tools/definitions';
import type { SessionState, SystemPromptSettings } from '../types';
import type { ToolConfig } from '../tools/config';

const DEFAULT_ENABLED_IDS = new Set([
  'get_datetime',
  'calculate',
  'web_search',
  'wikipedia_search',
]);

/** Default tool toggles aligned with defaultToolConfig(). */
export function defaultToolConfig(): ToolConfig {
  const enabled: Record<string, boolean> = {};
  for (const tool of BUILT_IN_TOOLS) {
    enabled[tool.id] = DEFAULT_ENABLED_IDS.has(tool.id);
  }
  return { enabled, keys: { braveApiKey: '' } };
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
    version: 1,
    activeId: chatId,
    sidebarCollapsed: false,
    chats: [
      {
        id: chatId,
        name: 'New chat',
        modelId: '',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: Date.now(),
      },
    ],
  };
}
