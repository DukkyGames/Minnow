/**
 * Merge repo LSP defaults with ~/.speedchat/lsp.json (OpenCode-compatible shape).
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

  return {
    enabled: user?.enabled !== false,
    lsp: merged,
  };
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
