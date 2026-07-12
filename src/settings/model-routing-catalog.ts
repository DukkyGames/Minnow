/**
 * Aggregates per-role model bindings for Settings → Model routing.
 *
 * Routing consumers (persistence → runtime):
 * - Work agents: work-agents.json + built-in frontmatter → resolveWorkAgentBinding
 * - Sub-agent types: sub-agents.json → resolveSubAgentModelBinding
 * - UI Designer: config.json uiDesigner → resolveUiDesignerModel
 * - Chat titles: config.json titles → resolveTitleGenerationOptions (schedule.ts)
 * - Goal evaluator: config.json goalEval → evaluateGoal (goal/evaluate.ts)
 * - Reef widget LLM: per-chat reefWidget* → run-widget-completion
 */

import { fetchWorkAgentsList } from '../agents/work-agent-prompt-api';
import { loadSubAgentConfig } from '../agents/sub-agent-config';
import { loadUiDesignerConfig } from '../agents/ui-designer/config';
import type { WorkAgentDefinition } from '../agents/work-agent-types';
import {
  computeEffectiveGoalEvalBinding,
  computeEffectiveTitleBinding,
  computeEffectiveWorkAgentBinding,
  resolveSubAgentModelBinding,
  resolveUiDesignerModel,
} from './model-routing-effective';
import { loadTitlesConfig } from '../config/titles-meta';
import { loadGoalEvalConfig } from '../config/goal-eval-meta';
import { loadSamplerMeta } from '../config/sampler-meta';
import { detectConfigServer, isConfigServerMode } from '../config/storage-mode';
import WORK_AGENT_THINKING_DEFAULTS from '../agents/defaults/work-agent-thinking.json';
import { getUserWorkAgentOverride } from '../agents/work-agent-registry';
import { getActiveChat } from '../state/sessions';
import type { SamplerPreset } from '../agents/sampler-types';
import type { ThinkingTriState } from '../agents/thinking-types';
import type { Chat } from '../types';

/** Routing target groups in Settings → Models. */
export type ModelRoutingGroup =
  | 'main-chat'
  | 'work-agents'
  | 'sub-agents'
  | 'background'
  | 'reef';

/** How a row is persisted when the user saves from Models hub. */
export type ModelRoutingPersistKind =
  | 'main-chat'
  | 'work-agent'
  | 'sub-agent'
  | 'ui-designer'
  | 'titles'
  | 'goal-eval'
  | 'reef-chat';

/**
 * One editable routing row in Settings → Model routing.
 * `providerId` / `modelId` are stored values; effective* mirrors runtime fallback for display.
 */
export interface ModelRoutingRow {
  id: string;
  group: ModelRoutingGroup;
  label: string;
  description?: string;
  providerId: string;
  modelId: string;
  usesChatDefault: boolean;
  disabled?: boolean;
  persistKind: ModelRoutingPersistKind;
  /** Legacy settings hash for prompts and advanced options. */
  advancedSettingsHash: string;
  effectiveProviderId: string;
  effectiveModelId: string;
  /** Reef-only: active chat display name. */
  activeChatName?: string;
  /** UI Designer: fallbackToChatModel flag from config. */
  fallbackToChatModel?: boolean;
  /** Titles: enabled flag from config. */
  titlesEnabled?: boolean;
  /** Stored sampler override (empty = inherit). */
  sampler?: SamplerPreset | null;
  /** Stored thinking tri-state when applicable. */
  thinkingMode?: ThinkingTriState;
  /** Stored thinking budget override (null = inherit, 0 = off). */
  thinkingBudgetTokens?: number | null;
  /** Main chat: per-chat thinking override from session. */
  chatThinkingMode?: ThinkingTriState;
}

export interface ModelRoutingCatalog {
  rows: ModelRoutingRow[];
  offline: boolean;
  activeChat: Chat;
  activeChatName: string;
}

export type { ChatBindingContext } from './model-routing-effective';
export {
  computeEffectiveTitleBinding,
  computeEffectiveWorkAgentBinding,
} from './model-routing-effective';

function rowFromWorkAgent(
  agent: WorkAgentDefinition,
  chatCtx: import('./model-routing-effective').ChatBindingContext,
  defaults: import('./model-routing-effective').ChatBindingContext,
): ModelRoutingRow {
  const storedProvider = agent.providerId ?? '';
  const storedModel = agent.modelId ?? '';
  const effective = computeEffectiveWorkAgentBinding(agent, chatCtx, defaults);
  return {
    id: agent.id,
    group: 'work-agents',
    label: agent.label,
    description: agent.description,
    providerId: storedProvider,
    modelId: storedModel,
    usesChatDefault: effective.usesChatDefault,
    disabled: agent.disabled === true,
    persistKind: 'work-agent',
    advancedSettingsHash: '#/settings/work-agents',
    effectiveProviderId: effective.providerId,
    effectiveModelId: effective.modelId,
    sampler: getUserWorkAgentOverride(agent.id)?.sampler ?? null,
    thinkingMode:
      getUserWorkAgentOverride(agent.id)?.thinkingMode ??
      ((WORK_AGENT_THINKING_DEFAULTS as Record<string, ThinkingTriState>)[agent.id] ??
        'inherit'),
    thinkingBudgetTokens: getUserWorkAgentOverride(agent.id)?.thinkingBudgetTokens ?? null,
  };
}

/** Load all routing rows for the consolidated settings section. */
export async function loadModelRoutingCatalog(
  defaults: import('./model-routing-effective').ChatBindingContext,
): Promise<ModelRoutingCatalog> {
  const serverUp = await detectConfigServer();
  const activeChat = getActiveChat();
  const chatCtx: import('./model-routing-effective').ChatBindingContext = {
    providerId: activeChat.providerId ?? defaults.providerId,
    modelId: activeChat.modelId || defaults.modelId,
  };
  const activeChatName = activeChat.name?.trim() || 'Untitled chat';

  if (!isConfigServerMode(serverUp)) {
    return { rows: [], offline: true, activeChat, activeChatName };
  }

  const [workAgentsRes, subAgentConfig, titlesConfig, goalEvalConfig, uiDesignerConfig, samplerMeta] =
    await Promise.all([
      fetchWorkAgentsList(),
      loadSubAgentConfig(),
      loadTitlesConfig(),
      loadGoalEvalConfig(),
      loadUiDesignerConfig(),
      loadSamplerMeta(),
    ]);

  const rows: ModelRoutingRow[] = [];

  rows.push({
    id: 'main-chat',
    group: 'main-chat',
    label: 'Main chat',
    description: 'Active session model (top-bar picker) and global sampler defaults.',
    providerId: chatCtx.providerId,
    modelId: chatCtx.modelId,
    usesChatDefault: false,
    persistKind: 'main-chat',
    advancedSettingsHash: '#/settings/sampler',
    effectiveProviderId: chatCtx.providerId,
    effectiveModelId: chatCtx.modelId,
    activeChatName,
    sampler: samplerMeta,
    chatThinkingMode: activeChat.thinkingMode ?? 'inherit',
  });

  for (const agent of workAgentsRes?.agents ?? []) {
    rows.push(rowFromWorkAgent(agent, chatCtx, defaults));
  }

  for (const [typeId, typeCfg] of Object.entries(subAgentConfig.types)) {
    const effective = resolveSubAgentModelBinding(typeCfg, activeChat);
    rows.push({
      id: typeId,
      group: 'sub-agents',
      label: typeCfg.label ?? typeId,
      description: typeCfg.workAgentId
        ? `Work agent: ${typeCfg.workAgentId}`
        : undefined,
      providerId: typeCfg.providerId,
      modelId: typeCfg.modelId,
      usesChatDefault: !typeCfg.modelId?.trim() && !typeCfg.providerId?.trim(),
      disabled: typeCfg.enabled === false,
      persistKind: 'sub-agent',
      advancedSettingsHash: '#/settings/sub-agents',
      effectiveProviderId: effective.providerId,
      effectiveModelId: effective.modelId,
      sampler: typeCfg.sampler ?? null,
      thinkingMode: typeCfg.thinkingMode ?? 'inherit',
      thinkingBudgetTokens: typeCfg.thinkingBudgetTokens ?? null,
    });
  }

  const uiResolved = resolveUiDesignerModel({
    uiDesigner: uiDesignerConfig,
    chatProviderId: chatCtx.providerId,
    chatModelId: chatCtx.modelId,
  });
  const uiEffective =
    'error' in uiResolved
      ? { providerId: '', modelId: '' }
      : { providerId: uiResolved.providerId, modelId: uiResolved.modelId };

  rows.push({
    id: 'ui-designer',
    group: 'background',
    label: 'UI Designer (skill/runtime)',
    description:
      'Model for /ui-designer skill turns. Separate from the ui-designer work-agent row.',
    providerId: uiDesignerConfig.providerId ?? '',
    modelId: uiDesignerConfig.modelId ?? '',
    usesChatDefault:
      !uiDesignerConfig.providerId?.trim() || !uiDesignerConfig.modelId?.trim(),
    persistKind: 'ui-designer',
    advancedSettingsHash: '#/settings/work-agents',
    effectiveProviderId: uiEffective.providerId,
    effectiveModelId: uiEffective.modelId,
    fallbackToChatModel: uiDesignerConfig.fallbackToChatModel !== false,
  });

  const titleEffective = computeEffectiveTitleBinding(titlesConfig, chatCtx);
  rows.push({
    id: 'chat-titles',
    group: 'background',
    label: 'Chat title jobs',
    description: 'First-message sidebar rename (background).',
    providerId: titlesConfig.providerId,
    modelId: titlesConfig.modelId,
    usesChatDefault: titleEffective.usesChatDefault,
    persistKind: 'titles',
    advancedSettingsHash: '#/settings/general',
    effectiveProviderId: titleEffective.providerId,
    effectiveModelId: titleEffective.modelId,
    titlesEnabled: titlesConfig.enabled,
  });

  const goalEvalEffective = computeEffectiveGoalEvalBinding(goalEvalConfig, chatCtx);
  rows.push({
    id: 'goal-eval',
    group: 'background',
    label: 'Goal evaluator',
    description: '/goal loop judge — reads transcript only (no tools).',
    providerId: goalEvalConfig.providerId,
    modelId: goalEvalConfig.modelId,
    usesChatDefault: goalEvalEffective.usesChatDefault,
    persistKind: 'goal-eval',
    advancedSettingsHash: '#/settings/model-routing',
    effectiveProviderId: goalEvalEffective.providerId,
    effectiveModelId: goalEvalEffective.modelId,
  });

  const reefProvider = activeChat.reefWidgetProviderId ?? '';
  const reefModel = activeChat.reefWidgetModelId ?? '';
  const reefEffectiveProvider =
    reefProvider.trim() || chatCtx.providerId;
  const reefEffectiveModel = reefModel.trim() || chatCtx.modelId;

  rows.push({
    id: 'reef-widget',
    group: 'reef',
    label: 'Reef widget LLM',
    description: 'callLLM inside Reef iframes for the active chat only.',
    providerId: reefProvider,
    modelId: reefModel,
    usesChatDefault: !reefModel.trim(),
    persistKind: 'reef-chat',
    advancedSettingsHash: '#/settings/modes',
    effectiveProviderId: reefEffectiveProvider,
    effectiveModelId: reefEffectiveModel,
    activeChatName,
  });

  return { rows, offline: false, activeChat, activeChatName };
}
