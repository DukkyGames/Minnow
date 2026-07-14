/**
 * Map OpenAI Chat Completions tool definitions to AI SDK ToolSet entries.
 */

import { jsonSchema, tool } from 'ai';

/**
 * @param {unknown} tools
 * @returns {Record<string, import('ai').Tool> | undefined}
 */
export function mapOpenAiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  /** @type {Record<string, import('ai').Tool>} */
  const mapped = {};

  for (const entry of tools) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type !== 'function' || !entry.function || typeof entry.function !== 'object') {
      continue;
    }
    const fn = entry.function;
    const name = typeof fn.name === 'string' ? fn.name.trim() : '';
    if (!name) continue;

    const parameters =
      fn.parameters && typeof fn.parameters === 'object'
        ? fn.parameters
        : { type: 'object', properties: {} };

    mapped[name] = tool({
      description: typeof fn.description === 'string' ? fn.description : '',
      inputSchema: jsonSchema(parameters),
    });
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

/**
 * @param {unknown} toolChoice
 * @returns {import('ai').ToolChoice<Record<string, unknown>> | undefined}
 */
export function mapOpenAiToolChoice(toolChoice) {
  if (toolChoice === undefined || toolChoice === null || toolChoice === 'auto') {
    return 'auto';
  }
  if (toolChoice === 'none') return 'none';
  if (toolChoice === 'required') return 'required';

  if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
    const fn = toolChoice.function;
    const toolName =
      fn && typeof fn === 'object' && typeof fn.name === 'string' ? fn.name.trim() : '';
    if (toolName) {
      return { type: 'tool', toolName };
    }
  }

  return 'auto';
}
