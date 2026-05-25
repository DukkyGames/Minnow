/**
 * Resolve shipped builtin baselines for file-backed Settings editors (API + bundle fallback).
 */

import {
  fetchWorkAgentBuiltinBaseline,
  type WorkAgentPromptProfile,
} from '../../agents/work-agent-prompt-api';
import {
  fetchPromptBuiltinBaseline,
  type PromptFileFamily,
  type PromptFileProfile,
} from './prompt-file-api';
import { loadBuiltinPromptById } from './prompt-loader';

export async function resolveFilePromptBuiltinBaseline(
  family: PromptFileFamily,
  entityId: string,
  profile: PromptFileProfile,
): Promise<string> {
  const fromApi = await fetchPromptBuiltinBaseline(family, entityId, profile);
  if (fromApi?.content != null) return fromApi.content;
  if (family === 'modes') {
    return loadBuiltinPromptById('mode', entityId, profile)?.body?.trim() ?? '';
  }
  if (family === 'experts') {
    return loadBuiltinPromptById('expert', entityId, profile)?.body?.trim() ?? '';
  }
  return '';
}

export async function resolveWorkAgentBuiltinBaselineText(
  agentId: string,
  profile: WorkAgentPromptProfile,
): Promise<string> {
  const fromApi = await fetchWorkAgentBuiltinBaseline(agentId, profile);
  if (fromApi?.content != null) return fromApi.content;
  return loadBuiltinPromptById('work-agent', agentId, profile)?.body?.trim() ?? '';
}
