/**
 * Resolve provider + model for an active Work Agent turn.
 */

import { listProviders } from '../providers/store';
import type { ProviderPublic } from '../providers/types';
import type { Chat } from '../types';
import type {
  WorkAgentBinding,
  WorkAgentDefinition,
  WorkAgentUserOverride,
} from './work-agent-types';
import { WorkAgentConfigError } from './work-agent-types';

export interface GlobalBindingDefaults {
  providerId: string;
  modelId: string;
}

export interface ResolveWorkAgentBindingOptions {
  /** User override from work-agents.json (highest priority for scalars). */
  userOverride?: WorkAgentUserOverride | null;
  /** Test injection: skip fetch when set. */
  providers?: ProviderPublic[];
}

/**
 * Resolve binding for send: provider URL, auth headers, model id.
 * Priority: user override → agent definition → chat model + active provider.
 */
export async function resolveWorkAgentBinding(
  agent: WorkAgentDefinition | null,
  chat: Chat,
  defaults: GlobalBindingDefaults,
  options?: ResolveWorkAgentBindingOptions,
): Promise<WorkAgentBinding> {
  const override = options?.userOverride;
  const agentId = agent?.id ?? 'default';

  let providerId =
    override?.providerId !== undefined
      ? override.providerId
      : agent?.providerId ?? null;
  let modelId =
    override?.modelId !== undefined ? override.modelId : agent?.modelId ?? null;

  if (providerId === null || providerId === '') {
    providerId = chat.providerId ?? defaults.providerId;
  }
  if (modelId === null || modelId === '') {
    modelId = chat.modelId || defaults.modelId;
  }

  if (!modelId) {
    throw new WorkAgentConfigError('No model selected for this chat');
  }

  const providers =
    options?.providers ?? (await listProviders()).providers;
  const provider = providers.find((p) => p.id === providerId && p.enabled !== false);

  if (!provider) {
    throw new WorkAgentConfigError(`Unknown provider id: ${providerId}`);
  }

  // Chat and tools use /api/generations; binding carries provider id only.
  const baseUrl = '';
  const headers: Record<string, string> = {};

  return {
    agentId,
    providerId,
    modelId,
    baseUrl,
    headers,
  };
}
