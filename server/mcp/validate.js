/**
 * MCP server id and stdio transport validation.
 */

const MCP_SERVER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Built-in / reserved ids — cannot be created or deleted via the API. */
export const RESERVED_MCP_SERVER_IDS = new Set(['context7', 'fixture']);

/**
 * @param {string} id
 * @returns {string}
 */
export function validateMcpServerId(id) {
  if (typeof id !== 'string' || !MCP_SERVER_ID_RE.test(id)) {
    throw new Error('Invalid server id (use lowercase letters, numbers, hyphens, underscores)');
  }
  if (RESERVED_MCP_SERVER_IDS.has(id)) {
    throw new Error(`Server id "${id}" is reserved`);
  }
  return id;
}

/**
 * @param {unknown} raw
 * @returns {{ type: 'stdio', command: string, args: string[], env: Record<string, string> }}
 */
export function validateStdioTransport(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('transport is required');
  }
  const transport = /** @type {Record<string, unknown>} */ (raw);
  if (transport.type !== 'stdio') {
    throw new Error('Only stdio transport is supported');
  }
  const command =
    typeof transport.command === 'string' ? transport.command.trim() : '';
  if (!command) {
    throw new Error('transport.command is required');
  }
  const args = Array.isArray(transport.args)
    ? transport.args.map((a) => String(a).trim()).filter(Boolean)
    : [];
  const env =
    transport.env && typeof transport.env === 'object' && !Array.isArray(transport.env)
      ? Object.fromEntries(
          Object.entries(/** @type {Record<string, unknown>} */ (transport.env)).map(
            ([k, v]) => [String(k), String(v)],
          ),
        )
      : {};
  return { type: 'stdio', command, args, env };
}

/**
 * @param {unknown} body
 */
export function validateCreateMcpServerBody(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body is required');
  }
  const payload = /** @type {Record<string, unknown>} */ (body);
  const id = validateMcpServerId(String(payload.id ?? ''));
  const label =
    typeof payload.label === 'string' && payload.label.trim()
      ? payload.label.trim()
      : id;
  const description =
    typeof payload.description === 'string' ? payload.description.trim() : '';
  const transport = validateStdioTransport(payload.transport);
  const enabled = payload.enabled !== false;
  return { id, label, description, transport, enabled };
}
