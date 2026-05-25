/**
 * Native tool plugin namespacing (parallel to MCP bridge).
 */

/** plugin__<pluginId>__<functionName> — hyphens in id become underscores in the namespace segment. */
export function toPluginNamespacedName(pluginId, functionName) {
  const safeId = String(pluginId).replace(/-/g, '_');
  const safeFn = String(functionName).replace(/-/g, '_');
  return `plugin__${safeId}__${safeFn}`;
}

/**
 * @param {string} name
 * @returns {{ pluginId: string, functionName: string } | null}
 */
export function parsePluginNamespacedName(name) {
  if (!name.startsWith('plugin__')) return null;
  const parts = name.slice(8).split('__');
  if (parts.length < 2) return null;
  const pluginId = parts[0].replace(/_/g, '-');
  const functionName = parts.slice(1).join('__').replace(/_/g, '-');
  return { pluginId, functionName };
}

export function isPluginToolName(name) {
  return typeof name === 'string' && name.startsWith('plugin__');
}

/**
 * @param {import('./scan.js').PluginManifest} manifest
 */
export function manifestToOpenAIDefinition(manifest) {
  return {
    type: 'function',
    function: {
      name: toPluginNamespacedName(manifest.id, manifest.functionName),
      description: manifest.description,
      parameters: manifest.parameters ?? { type: 'object', properties: {} },
    },
  };
}
