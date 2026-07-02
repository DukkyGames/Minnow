/**
 * Build ComposeContext from app config, tools, and session state.
 */

import {
  resolveActiveWorkAgent,
  resolveActiveWorkAgentId,
} from '../../agents/resolve-work-agent';
import { listExperts } from '../experts/registry';
import { normalizeModeId } from '../modes/types';
import { loadExpertsConfig } from '../../config/experts-config';
import { loadPromptMetaSettings } from '../../config/prompt-meta';
import {
  getUserRulesPayloadForSend,
  loadUserRules,
} from '../../config/user-rules';
import { getExpertSelection, sessionState } from '../../state/sessions';
import { resolveChatToolWorkspaceRoot } from '../../state/worktree-isolation';
import { getEnabledToolDefinitionsForMode } from '../../tools/client';
import { loadToolConfig } from '../../tools/config';
import type { Chat } from '../../types';
import { retrieveMemoryBlock } from '../../memory/client';
import { shouldInjectMemory } from '../../memory/config';
import { loadPromptConfig } from './prompt-configs';
import { getWorkspacePath } from '../../state/workspace';
import type { ComposeContext, PromptProfile } from './types';
import { normalizeOrchestratePlanPath } from '../orchestrate/plan-path';

/** Workspace folder path for {{cwd}} in system prompts (falls back to origin). */
export function resolveComposeCwd(): string {
  const workspace = getWorkspacePath();
  if (workspace.trim()) {
    return workspace;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '.';
}

function getEnabledToolIdsForChat(chat: Chat): string[] {
  loadToolConfig();
  const modeId = normalizeModeId(chat.modeId);
  const defs = getEnabledToolDefinitionsForMode(modeId);
  return defs.map((d) => d.function.name);
}

export interface BuildComposeContextOptions {
  userMessagePreview?: string;
  /** When set, used for expert routing instead of last history message. */
  routeUserText?: string;
  overrides?: Partial<ComposeContext>;
}

export interface ResolvedExpertContext {
  expertId: string | null;
  expertLabel: string | null;
  routeSource: string;
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

  const modeId = normalizeModeId(chat.modeId);
  const orchestratePlanPath =
    modeId === 'orchestrate'
      ? normalizeOrchestratePlanPath(chat.orchestratePlanPath) ?? null
      : null;
  const enabledToolIds = getEnabledToolIdsForChat(chat);
  void getEnabledToolDefinitionsForMode(modeId);

  const infoPresetId =
    options?.overrides?.infoPresetId ??
    meta.activeInfoPresetId ??
    'general-assistant';

  let memoryBlock: string | null = null;
  const injectMemory = await shouldInjectMemory(chat);
  if (injectMemory) {
    const query =
      options?.routeUserText ??
      options?.userMessagePreview ??
      '';
    memoryBlock =
      (await retrieveMemoryBlock({
        query,
        profile,
      })) || null;
  }

  const worktreeCwd = resolveChatToolWorkspaceRoot(chat, sessionState?.groups);
  const ctx: ComposeContext = {
    profile,
    customConfigId: meta.activePromptConfigId,
    customConfig,
    cwd: worktreeCwd ?? resolveComposeCwd(),
    modeId,
    orchestratePlanPath,
    expertId: null,
    workAgentId: null,
    skillBody: null,
    memoryBlock,
    enabledToolIds,
    infoPresetId,
    planGranularity: meta.planGranularity ?? 'medium',
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
 * Resolve expert for send: manual selection or expert-thread chat only (no auto-routing).
 */
export async function resolveExpertContextForSend(
  chat: Chat,
  _userText: string,
): Promise<ResolvedExpertContext> {
  const expertsConfig = await loadExpertsConfig();
  if (!expertsConfig.enabled) {
    return { expertId: null, expertLabel: null, routeSource: 'none' };
  }

  const threadExpertId =
    chat.kind === 'expert' && chat.expertId?.trim() ? chat.expertId.trim() : null;
  const selection = getExpertSelection(chat);
  const manualId =
    selection.mode === 'manual' && selection.expertId?.trim()
      ? selection.expertId.trim()
      : null;
  const expertId = threadExpertId ?? manualId;
  if (!expertId) {
    return { expertId: null, expertLabel: null, routeSource: 'none' };
  }

  const expert = listExperts().find((r) => r.meta.id === expertId);
  if (!expert) {
    return { expertId: null, expertLabel: null, routeSource: 'none' };
  }

  return {
    expertId: expert.meta.id,
    expertLabel: expert.meta.label,
    routeSource: 'manual',
  };
}

/**
 * Resolve composed system prompt for send path (async config + compose).
 */
export async function resolveComposedSystemPrompt(
  chat: Chat,
  options?: BuildComposeContextOptions,
): Promise<string> {
  const { composeSystemPrompt } = await import('./prompt-composer');
  const routeText =
    options?.routeUserText ??
    options?.userMessagePreview ??
  '';

  const expertCtx = await resolveExpertContextForSend(chat, routeText);

  const activeWorkAgent = resolveActiveWorkAgent(chat);
  const workAgentId = resolveActiveWorkAgentId(chat);

  const ctx = await buildComposeContext(chat, {
    ...options,
    overrides: {
      expertId: expertCtx.expertId,
      expertLabel: expertCtx.expertLabel,
      workAgentId,
      workAgentLabel: activeWorkAgent?.label ?? null,
      ...options?.overrides,
    },
  });
  return composeSystemPrompt(ctx);
}

/** Outbound system messages for LM Studio (composed prompt + optional user rules). */
export interface OutboundSystemMessages {
  /** Primary system content (composed stack or legacy textarea fallback). */
  composed: string;
  /** Second system message body when rules are enabled and non-empty. */
  userRules: string | null;
}

/**
 * Resolve composed programmatic prompt and optional user rules for send.
 * Shared by tool loop, plain chat, and token estimate (F25).
 */
export async function resolveOutboundSystemMessages(
  chat: Chat,
  legacySysPrompt: string,
  options?: BuildComposeContextOptions,
): Promise<OutboundSystemMessages> {
  let composedRaw = '';
  try {
    composedRaw = await resolveComposedSystemPrompt(chat, options);
  } catch {
    composedRaw = '';
  }
  const composed = composedRaw.trim() || legacySysPrompt.trim();
  const rulesSettings = await loadUserRules();
  const userRules = getUserRulesPayloadForSend(rulesSettings);
  return { composed, userRules };
}
