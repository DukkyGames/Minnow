/**
 * Merge repo LSP defaults with ~/.minnow/lsp.json (OpenCode-compatible shape).
 */

/**
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} user
 */
export function mergeLspConfig(defaults, user) {
  const base = defaults?.lsp && typeof defaults.lsp === 'object' ? defaults.lsp : {};
  const over = user?.lsp && typeof user.lsp === 'object' ? user.lsp : {};
  const merged = { ...base };

  for (const [id, entry] of Object.entries(over)) {
    if (!entry || typeof entry !== 'object') continue;
    merged[id] = {
      ...(merged[id] && typeof merged[id] === 'object' ? merged[id] : {}),
      ...entry,
    };
  }

  const formatOnSaveLanguageIds = Array.isArray(user?.formatOnSaveLanguageIds)
    ? user.formatOnSaveLanguageIds.map((id) => String(id))
    : [];

  return {
    enabled: user?.enabled !== false,
    formatOnSaveLanguageIds,
    lsp: merged,
  };
}

/**
 * Whether the connected server advertises whole-document formatting.
 * @param {Record<string, unknown> | undefined} serverCapabilities
 */
export function serverSupportsDocumentFormatting(serverCapabilities) {
  const provider = serverCapabilities?.documentFormattingProvider;
  if (provider === true) return true;
  if (provider && typeof provider === 'object') return true;
  return false;
}

/**
 * Whether the connected server advertises range formatting.
 * @param {Record<string, unknown> | undefined} serverCapabilities
 */
export function serverSupportsRangeFormatting(serverCapabilities) {
  const provider = serverCapabilities?.documentRangeFormattingProvider;
  if (provider === true) return true;
  if (provider && typeof provider === 'object') return true;
  return false;
}

/** Built-in servers known to implement workspace/symbol when init capabilities are unavailable. */
const DEFAULT_WORKSPACE_SYMBOL_SERVER_IDS = new Set([
  'typescript',
  'pyright',
  'rust',
  'gopls',
  'clangd',
  'lua-ls',
  'terraform',
  'zls',
  'fake',
]);

/**
 * Whether an LSP server should receive workspace/symbol requests.
 * @param {string} id
 * @param {Record<string, unknown> | undefined} cfg
 * @param {Record<string, unknown> | undefined} [serverCapabilities]
 */
export function serverSupportsWorkspaceSymbols(id, cfg, serverCapabilities) {
  if (cfg?.workspaceSymbols === false) return false;
  if (cfg?.workspaceSymbols === true) return true;
  const provider = serverCapabilities?.workspaceSymbolProvider;
  if (provider === true) return true;
  if (provider === false) return false;
  return DEFAULT_WORKSPACE_SYMBOL_SERVER_IDS.has(id);
}

/** Servers matching file extension that are not disabled. */
export function matchServersForPath(merged, filePath) {
  const ext = filePath.includes('.')
    ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    : '';
  const out = [];
  for (const [id, cfg] of Object.entries(merged.lsp ?? {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    if (cfg.disabled === true) continue;
    const exts = Array.isArray(cfg.extensions) ? cfg.extensions : [];
    if (exts.some((e) => String(e).toLowerCase() === ext)) {
      out.push({ id, config: cfg });
    }
  }
  return out;
}
