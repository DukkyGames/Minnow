/**
 * Server re-export of shared untrusted-content helpers.
 */

export {
  escapeGuardMarkers,
  GUARD_CLOSE,
  GUARD_OPEN_PREFIX,
  isWrappedUntrusted,
  sanitizeSourceLabel,
  UNTRUSTED_CONTEXT_POLICY_FULL,
  UNTRUSTED_CONTEXT_POLICY_LITE,
  wrapUntrusted,
} from '../../src/lib/untrusted.mjs';

import { isMcpToolName } from '../mcp/registry.js';
import path from 'node:path';
import { isWrappedUntrusted, wrapUntrusted } from '../../src/lib/untrusted.mjs';

/** Per-tool source labels for middleware wrapping of server tool output. */
const TOOL_SOURCE_RESOLVERS = {
  fetch_web_content: (args) => `web:${String(args?.url ?? 'unknown').trim()}`,
  rag_web_content: (args) => `web-rag:${String(args?.url ?? 'unknown').trim()}`,
  read_document: (args) => {
    const name =
      typeof args?.filename === 'string' && args.filename.trim()
        ? path.basename(args.filename.trim())
        : 'document';
    return `document:${name}`;
  },
  web_search_ddg: () => 'web-search:ddg',
  web_search_tavily: () => 'web-search:tavily',
  web_search_searxng: () => 'web-search:searxng',
};

/**
 * Whether a tool result string should be wrapped at the middleware boundary.
 * @param {string} toolName
 * @param {string} result
 * @returns {boolean}
 */
export function shouldWrapServerToolResult(toolName, result) {
  if (typeof result !== 'string' || !result.trim()) {
    return false;
  }
  if (result.startsWith('Error:')) {
    return false;
  }
  if (isWrappedUntrusted(result)) {
    return false;
  }
  if (toolName in TOOL_SOURCE_RESOLVERS) {
    return true;
  }
  return isMcpToolName(toolName);
}

/**
 * Wrap a server tool result when it carries untrusted external text.
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @param {string} result
 * @returns {string}
 */
export function wrapServerToolResult(toolName, args, result) {
  const text = String(result ?? '');
  if (!shouldWrapServerToolResult(toolName, text)) {
    return text;
  }

  const resolver = TOOL_SOURCE_RESOLVERS[toolName];
  const source = resolver
    ? resolver(args ?? {})
    : `mcp:${toolName.replace(/^mcp_/, '')}`;

  return wrapUntrusted(text, { source });
}
