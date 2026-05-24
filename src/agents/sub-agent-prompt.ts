/**
 * Build system prompts for sub-agent runs.
 */

import { interpolatePromptBody } from '../chat/prompts/interpolate';
import { loadPromptById } from '../chat/prompts/prompt-loader';
import { fetchPromptFile } from '../chat/prompts/prompt-file-api';
import { getPromptMetaSettingsSync } from '../config/prompt-meta';
import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
import { fetchMemoryEnabled, retrieveMemoryBlock } from '../memory/client';
import {
  fetchMemoryInjectionEnabled,
  isMemoryEnabledForChat,
} from '../memory/config';
import type { Chat } from '../types';
import { SHIPPED_SUB_AGENT_PROMPTS } from './shipped-sub-agent-prompts';
import { getWorkAgentPromptOverride } from './work-agent-registry';
import { fetchWorkAgentPrompt } from './work-agent-prompt-api';
import type { SubAgentTypeConfig } from './types';

/** Load shipped sub-agent prompt body for a type. */
function loadShippedSubAgentPrompt(typeId: string, profile: 'full' | 'lite'): string {
  const key = `${typeId}.${profile}`;
  return SHIPPED_SUB_AGENT_PROMPTS[key]?.trim() ?? '';
}

/**
 * Resolve base prompt: work agent binding, user path override, or shipped file.
 */
export async function resolveSubAgentBasePrompt(
  typeId: string,
  typeConfig: SubAgentTypeConfig,
): Promise<string> {
  if (typeConfig.workAgentId) {
    const override = getWorkAgentPromptOverride(typeConfig.workAgentId);
    if (override) return override;

    const meta = getPromptMetaSettingsSync();
    const profile = meta.activePromptProfile === 'lite' ? 'lite' : 'full';
    const fetched = await fetchWorkAgentPrompt(typeConfig.workAgentId, profile);
    if (fetched?.content?.trim()) return fetched.content.trim();
  }

  const meta = getPromptMetaSettingsSync();
  const profile = meta.activePromptProfile === 'lite' ? 'lite' : 'full';

  await detectConfigServer();
  if (isServerStorageMode()) {
    const fromApi = await fetchPromptFile('sub-agents', typeId, profile);
    if (fromApi?.content?.trim()) return fromApi.content.trim();
  }

  const shipped = loadShippedSubAgentPrompt(typeId, profile);
  if (shipped) return shipped;

  return `You are a focused sub-agent (${typeId}). Complete tasks efficiently and return a concise summary.`;
}

/**
 * Full system prompt with task envelope for the sub-agent runner.
 */
const SUB_AGENT_ASK_QUESTION_RULES = `

### User choices (sub-agent)
When you need the user to pick among options, priorities, or approvals, call \`ask_question\` — do not list numbered or lettered choices in prose.`;

/** Append ask_question rules when the sub-agent has that tool enabled. */
export function appendSubAgentAskQuestionRules(
  systemPrompt: string,
  enabledToolNames: string[],
): string {
  if (!enabledToolNames.includes('ask_question')) {
    return systemPrompt;
  }
  if (systemPrompt.includes('ask_question')) {
    return systemPrompt;
  }
  return `${systemPrompt}${SUB_AGENT_ASK_QUESTION_RULES}`;
}

const SUB_AGENT_SAVE_MEMORY_RULES = `

### Memory (sub-agent)
Notes below are from prior sessions — treat as context and verify against the codebase.
Use \`save_memory\` for stable preferences or explicit "remember this" requests (not secrets or one-off state). Confirm only after the tool succeeds.`;

/** Inject retrieved memories and optional save_memory guidance for sub-agents. */
export async function appendSubAgentMemorySection(
  systemPrompt: string,
  task: string,
  enabledToolNames: string[],
  parentChat?: Chat | null,
): Promise<string> {
  const injectionOn = await fetchMemoryInjectionEnabled();
  if (!injectionOn) {
    return appendSubAgentSaveMemoryRules(systemPrompt, enabledToolNames);
  }
  const globalEnabled = await fetchMemoryEnabled();
  const inject = parentChat
    ? isMemoryEnabledForChat(parentChat, globalEnabled)
    : globalEnabled;
  if (!inject) {
    return appendSubAgentSaveMemoryRules(systemPrompt, enabledToolNames);
  }

  const meta = getPromptMetaSettingsSync();
  const profile = meta.activePromptProfile === 'lite' ? 'lite' : 'full';
  const block = await retrieveMemoryBlock({ query: task, profile });

  let result = systemPrompt;
  if (block.trim()) {
    const loaded = loadPromptById('info', 'memory', profile);
    const template = loaded?.body?.trim() ?? 'Prior notes:\n\n{{memory}}';
    const section = interpolatePromptBody(template, {
      mode: '',
      mode_label: '',
      profile,
      expert: '',
      enabled_tools: '',
      cwd: '',
      memory: block,
      user_message: task,
      chat_history_summary: '',
      work_agent: '',
      work_agent_label: '',
      skill: '',
      date: new Date().toISOString().slice(0, 10),
      os: typeof navigator !== 'undefined' ? navigator.platform : 'node',
      plan_granularity: '',
      orchestrate_plan: '',
    });
    if (section.trim()) {
      result = `${result}\n\n---\n\n${section.trim()}`;
    }
  }

  return appendSubAgentSaveMemoryRules(result, enabledToolNames);
}

function appendSubAgentSaveMemoryRules(
  systemPrompt: string,
  enabledToolNames: string[],
): string {
  if (!enabledToolNames.includes('save_memory')) {
    return systemPrompt;
  }
  if (systemPrompt.includes('save_memory')) {
    return systemPrompt;
  }
  return `${systemPrompt}${SUB_AGENT_SAVE_MEMORY_RULES}`;
}

export async function buildSubAgentSystemPrompt(
  typeId: string,
  task: string,
  typeConfig: SubAgentTypeConfig,
  enabledToolNames: string[] = [],
  parentChat?: Chat | null,
): Promise<string> {
  const base = await resolveSubAgentBasePrompt(typeId, typeConfig);
  const envelope = `${base}

---

You are a sub-agent (type: ${typeId}). Complete the following task. You cannot spawn other sub-agents.
Return a concise summary for the parent when done.

Task:
${task}`;
  const withMemory = await appendSubAgentMemorySection(
    envelope,
    task,
    enabledToolNames,
    parentChat,
  );
  return appendSubAgentAskQuestionRules(withMemory, enabledToolNames);
}
