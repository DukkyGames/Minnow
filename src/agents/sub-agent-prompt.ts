/**
 * Build system prompts for sub-agent runs.
 */

import { fetchPromptFile } from '../chat/prompts/prompt-file-api';
import { getPromptMetaSettingsSync } from '../config/prompt-meta';
import { detectConfigServer, isServerStorageMode } from '../config/storage-mode';
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
export async function buildSubAgentSystemPrompt(
  typeId: string,
  task: string,
  typeConfig: SubAgentTypeConfig,
): Promise<string> {
  const base = await resolveSubAgentBasePrompt(typeId, typeConfig);
  return `${base}

---

You are a sub-agent (type: ${typeId}). Complete the following task. You cannot spawn other sub-agents.
Return a concise summary for the parent when done.

Task:
${task}`;
}
