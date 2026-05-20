/**
 * MCP tool namespacing and OpenAI function definition mapping.
 */

/** mcp__<serverId>__<toolName> */
export function toNamespacedName(serverId, toolName) {
  const safeTool = String(toolName).replace(/-/g, '_');
  return `mcp__${serverId}__${safeTool}`;
}

export function parseNamespacedName(name) {
  if (!name.startsWith('mcp__')) return null;
  const parts = name.slice(5).split('__');
  if (parts.length < 2) return null;
  const serverId = parts[0];
  const toolName = parts.slice(1).join('__').replace(/_/g, '-');
  return { serverId, toolName };
}

/**
 * @param {string} serverId
 * @param {Array<{ name: string, description?: string, inputSchema?: object }>} tools
 */
export function toOpenAIDefinitions(serverId, tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: toNamespacedName(serverId, tool.name),
      description: tool.description ?? `MCP tool ${tool.name} from ${serverId}`,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}
