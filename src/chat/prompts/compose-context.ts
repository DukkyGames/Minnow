/**
 * Build ComposeContext from app config, tools, and session state.
 */

import { loadPromptMetaSettings } from '../../config/prompt-meta';
import { BUILT_IN_TOOLS } from '../../tools/definitions';
import { getEnabledToolDefinitions } from '../../tools/client';
import { isLocalServerAvailable, loadToolConfig } from '../../tools/config';
import type { Chat } from '../../types';
import { loadPromptConfig } from './prompt-configs';
import type { ComposeContext, PromptProfile } from './types';

/** Browser project root for {{cwd}} — dev server cwd when tools run. */
export function resolveComposeCwd(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '.';
}

function getEnabledToolIds(): string[] {
  loadToolConfig();
  const serverUp = isLocalServerAvailable();
  return BUILT_IN_TOOLS.filter((tool) => {
    const config = loadToolConfig();
    if (!config.enabled[tool.id]) return false;
    if (tool.serverRequired && !serverUp) return false;
    return true;
  }).map((tool) => tool.id);
}

/** Full-profile tool list with one-line descriptions for {{enabled_tools}}. */
export function formatEnabledToolsFull(ids: string[]): string {
  if (ids.length === 0) return '';
  return ids
    .map((id) => {
      const tool = BUILT_IN_TOOLS.find((t) => t.id === id);
      if (!tool) return id;
      return `${tool.id}: ${tool.description}`;
    })
    .join('\n');
}

/** Lite-profile compact tool list (ids only, max 12). */
export function formatEnabledToolsLite(ids: string[]): string {
  if (ids.length === 0) return '';
  const max = 12;
  if (ids.length <= max) return ids.join(', ');
  const shown = ids.slice(0, max).join(', ');
  return `${shown} …(+${ids.length - max})`;
}

export interface BuildComposeContextOptions {
  userMessagePreview?: string;
  overrides?: Partial<ComposeContext>;
}

/**
 * Assemble compose context for the active chat and config.
 */
export async function buildComposeContext(
  chat: Chat,
  options?: BuildComposeContextOptions,
): Promise<ComposeContext> {
  const meta = await loadPromptMetaSettings();
  const profile: PromptProfile = meta.activePromptProfile;

  let customConfig = null;
  if (profile === 'custom' && meta.activePromptConfigId) {
    const loaded = await loadPromptConfig(meta.activePromptConfigId);
    if (loaded && !(loaded instanceof Error)) {
      customConfig = loaded;
    }
  }

  const enabledToolIds = getEnabledToolIds();
  // Ensure tool definitions are loaded for downstream tool loop
  void getEnabledToolDefinitions();

  const infoPresetId =
    options?.overrides?.infoPresetId ??
    meta.activeInfoPresetId ??
    'general-assistant';

  const ctx: ComposeContext = {
    profile,
    customConfigId: meta.activePromptConfigId,
    customConfig,
    cwd: resolveComposeCwd(),
    modeId: null,
    expertId: null,
    workAgentId: null,
    skillBody: null,
    memoryBlock: null,
    enabledToolIds,
    enabledToolSummaries:
      profile === 'lite'
        ? formatEnabledToolsLite(enabledToolIds)
        : formatEnabledToolsFull(enabledToolIds),
    infoPresetId,
    userMessagePreview:
      options?.userMessagePreview ??
      chat.history
        .slice()
        .reverse()
        .find((m) => m.role === 'user')
        ?.content?.slice(0, 200) ??
      '',
    includeChatHistorySummary: false,
    ...options?.overrides,
  };

  return ctx;
}

/**
 * Resolve composed system prompt for send path (async config + compose).
 */
export async function resolveComposedSystemPrompt(
  chat: Chat,
  options?: BuildComposeContextOptions,
): Promise<string> {
  const { composeSystemPrompt } = await import('./prompt-composer');
  const ctx = await buildComposeContext(chat, options);
  return composeSystemPrompt(ctx);
}
