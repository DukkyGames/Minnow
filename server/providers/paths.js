/**
 * Default API paths per provider apiKind.
 * LM Studio list/chat use v0; load/unload use v1 REST on the same baseUrl.
 */

/**
 * @param {'lm-studio-v0' | 'openai-v1'} apiKind
 */
export function getProviderCapabilities(apiKind) {
  return {
    supportsModelLoadUnload: apiKind === 'lm-studio-v0',
  };
}

/**
 * @param {'lm-studio-v0' | 'openai-v1'} apiKind
 * @param {{ modelsPath?: string, chatCompletionsPath?: string, modelsLoadPath?: string, modelsUnloadPath?: string }} [overrides]
 */
export function getDefaultPaths(apiKind, overrides = {}) {
  const defaults =
    apiKind === 'openai-v1'
      ? { modelsPath: '/v1/models', chatCompletionsPath: '/v1/chat/completions' }
      : {
          modelsPath: '/api/v0/models',
          chatCompletionsPath: '/api/v0/chat/completions',
          modelsLoadPath: '/api/v1/models/load',
          modelsUnloadPath: '/api/v1/models/unload',
        };

  const out = {
    modelsPath: overrides.modelsPath || defaults.modelsPath,
    chatCompletionsPath: overrides.chatCompletionsPath || defaults.chatCompletionsPath,
  };

  if (defaults.modelsLoadPath) {
    out.modelsLoadPath = overrides.modelsLoadPath || defaults.modelsLoadPath;
    out.modelsUnloadPath = overrides.modelsUnloadPath || defaults.modelsUnloadPath;
  }

  return out;
}

/**
 * @param {'lm-studio-v0' | 'openai-v1'} apiKind
 * @param {unknown} json
 * @returns {{ data: Array<{ id: string, type?: string, state?: string }> }}
 */
export function normalizeModelsResponse(apiKind, json) {
  if (!json || typeof json !== 'object') {
    return { data: [] };
  }

  if (apiKind !== 'openai-v1') {
    const data = Array.isArray(/** @type {{ data?: unknown }} */ (json).data)
      ? /** @type {{ data: unknown[] }} */ (json).data
      : [];
    return { data };
  }

  const raw = Array.isArray(/** @type {{ data?: unknown }} */ (json).data)
    ? /** @type {{ data: unknown[] }} */ (json).data
    : [];

  const data = raw.map((item) => {
    if (typeof item === 'string') {
      return { id: item, type: 'llm', state: 'loaded' };
    }
    if (item && typeof item === 'object' && 'id' in item) {
      const row = /** @type {{ id: string, type?: string, state?: string }} */ (item);
      return {
        id: row.id,
        type: row.type || 'llm',
        state: row.state || 'loaded',
      };
    }
    return { id: String(item), type: 'llm', state: 'loaded' };
  });

  return { data };
}
