/**
 * Resolve provider + model for Deep Research runs.
 * Uses the active chat/composer binding (same path as chat send), not the global default alone.
 */

import { loadResearchConfig, peekResearchConfig } from '../config/research-config';
import { resolveEffectiveChatModelBinding } from '../ui/default-model';
import { getActiveChat } from '../state/sessions';

export interface ResolveResearchModelBindingOptions {
  overrideProvider?: string;
  overrideModel?: string;
}

/** Same priority as {@link resolveResearchModelBinding}, without network (uses config cache). */
export function resolveResearchModelBindingSync(
  options: ResolveResearchModelBindingOptions = {},
): { providerId: string; model: string } {
  const overrideProvider = options.overrideProvider?.trim() ?? '';
  const overrideModel = options.overrideModel?.trim() ?? '';

  if (overrideProvider && overrideModel) {
    return { providerId: overrideProvider, model: overrideModel };
  }

  const fromConfig = peekResearchConfig().model;
  if (fromConfig.providerId?.trim() && fromConfig.model?.trim()) {
    return {
      providerId: fromConfig.providerId.trim(),
      model: fromConfig.model.trim(),
    };
  }

  const binding = resolveEffectiveChatModelBinding(getActiveChat());
  return {
    providerId: binding.providerId?.trim() ?? '',
    model: binding.modelId?.trim() ?? '',
  };
}

/**
 * Priority: per-run UI overrides → Settings → Deep Research model → active chat/composer model.
 */
export async function resolveResearchModelBinding(
  options: ResolveResearchModelBindingOptions = {},
): Promise<{ providerId: string; model: string }> {
  const overrideProvider = options.overrideProvider?.trim() ?? '';
  const overrideModel = options.overrideModel?.trim() ?? '';

  if (overrideProvider && overrideModel) {
    return { providerId: overrideProvider, model: overrideModel };
  }

  await loadResearchConfig();
  return resolveResearchModelBindingSync(options);
}
