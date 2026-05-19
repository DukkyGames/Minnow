/**
 * Default API paths per provider apiKind.
 */

/**
 * @param {'lm-studio-v0' | 'openai-v1'} apiKind
 * @param {{ modelsPath?: string, chatCompletionsPath?: string }} [overrides]
 */
export function getDefaultPaths(apiKind, overrides = {}) {
  const defaults =
    apiKind === 'openai-v1'
      ? { modelsPath: '/v1/models', chatCompletionsPath: '/v1/chat/completions' }
      : {
          modelsPath: '/api/v0/models',
          chatCompletionsPath: '/api/v0/chat/completions',
        };

  return {
    modelsPath: overrides.modelsPath || defaults.modelsPath,
    chatCompletionsPath: overrides.chatCompletionsPath || defaults.chatCompletionsPath,
  };
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
