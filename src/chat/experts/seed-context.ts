/**
 * Build validation context for resolveExpertChatSeed from live catalog state.
 */

import { listModes } from '../modes/registry';
import { normalizeModeId } from '../modes/types';
import { getEnabledToolDefinitionsForMode } from '../../tools/client';
import { loadToolConfig } from '../../tools/config';
import { decodeModelSelectKey } from '../../lib/model-select-key';
import type { ExpertSeedValidationContext } from './runtime-profile';

/** Collect model keys from #modelSelect options for override validation. */
export function buildExpertSeedValidationContext(): ExpertSeedValidationContext {
  loadToolConfig();
  const availableModeIds = new Set(listModes().map((m) => m.id));
  const availableModelKeys = new Set<string>();

  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (sel) {
    for (const opt of sel.options) {
      const raw = opt.value.trim();
      if (!raw) continue;
      availableModelKeys.add(raw);
      const decoded = decodeModelSelectKey(raw);
      if (decoded?.modelId) {
        availableModelKeys.add(decoded.modelId);
        if (decoded.providerId) {
          availableModelKeys.add(`${decoded.providerId}:${decoded.modelId}`);
        }
      }
    }
  }

  return {
    availableModeIds,
    availableModelKeys,
    resolveModeToolNames: (modeId) => {
      const defs = getEnabledToolDefinitionsForMode(normalizeModeId(modeId));
      return defs.map((d) => d.function.name);
    },
  };
}
