/**
 * UI Designer model binding from ~/.minnow config.json (Step 15).
 */

import { listProviders } from '../../providers/store';
import type { ProviderPublic } from '../../providers/types';
import type { Chat } from '../../types';
import type { WorkAgentBinding } from '../work-agent-types';
import { WorkAgentConfigError } from '../work-agent-types';
import {
  normalizeUiDesignerConfig,
  resolveUiDesignerModel,
  type UiDesignerConfig,
  type UiDesignerConfigMeta,
} from './model-resolution';

export type { UiDesignerConfig, UiDesignerConfigMeta };
export { normalizeUiDesignerConfig, resolveUiDesignerModel };

/** Load uiDesigner section from GET /api/config/meta. */
export async function loadUiDesignerConfig(): Promise<UiDesignerConfig> {
  try {
    const res = await fetch('/api/config/meta', { cache: 'no-store' });
    if (!res.ok) return normalizeUiDesignerConfig(null);
    const body = (await res.json()) as UiDesignerConfigMeta;
    return normalizeUiDesignerConfig(body.uiDesigner);
  } catch {
    return normalizeUiDesignerConfig(null);
  }
}

export interface ResolveUiDesignerBindingOptions {
  providers?: ProviderPublic[];
}

/** Full binding for chat send (mirrors resolveWorkAgentBinding). */
export async function resolveUiDesignerBinding(
  chat: Chat,
  defaults: { providerId: string; modelId: string },
  options?: ResolveUiDesignerBindingOptions,
): Promise<WorkAgentBinding> {
  const uiCfg = await loadUiDesignerConfig();
  const resolved = resolveUiDesignerModel({
    uiDesigner: uiCfg,
    chatProviderId: chat.providerId ?? defaults.providerId,
    chatModelId: chat.modelId || defaults.modelId,
  });

  if ('error' in resolved) {
    throw new WorkAgentConfigError(resolved.error);
  }

  const providers =
    options?.providers ?? (await listProviders()).providers;
  const provider = providers.find(
    (p) => p.id === resolved.providerId && p.enabled !== false,
  );

  if (!provider) {
    throw new WorkAgentConfigError(`Unknown provider id: ${resolved.providerId}`);
  }

  const baseUrl = '';

  return {
    agentId: 'ui-designer',
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    baseUrl,
    headers: {},
  };
}
