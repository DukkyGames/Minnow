/**
 * Agent-facing Brain code-index tools — repo map, symbol search, call graph, read def.
 */

import {
  callsOf,
  ensureWarmCodeIndex,
  explainSymbol,
  findSymbol,
  loadBrainCodeConfig,
  readSymbol,
  repoMap,
  whoCalls,
} from '../brain/code/query.js';

async function ensureCodeEnabled() {
  const code = await loadBrainCodeConfig();
  if (!code.enabled) {
    return 'Error: Brain code index is disabled in Settings → Brain → Code.';
  }
  return null;
}

/**
 * Token-budgeted signature map of the indexed repo.
 * @param {Record<string, unknown>} args
 */
export async function toolRepoMap(args) {
  const disabled = await ensureCodeEnabled();
  if (disabled) return disabled;

  const warm = await ensureWarmCodeIndex();
  if (!warm.symbolCount) {
    return 'Code index is cold. Reindex failed or workspace has no indexable files. Use `grep` as fallback.';
  }

  const map = await repoMap({
    focus: args?.focus != null ? String(args.focus) : undefined,
    tokenBudget:
      typeof args?.token_budget === 'number'
        ? args.token_budget
        : typeof args?.tokenBudget === 'number'
          ? args.tokenBudget
          : undefined,
    focusFiles: Array.isArray(args?.focus_files)
      ? args.focus_files.map((f) => String(f))
      : Array.isArray(args?.focusFiles)
        ? args.focusFiles.map((f) => String(f))
        : undefined,
  });
  return map.text;
}

/**
 * Find a symbol definition by name, file-path fragment, or signature (SQLite index; LSP when cold).
 * @param {Record<string, unknown>} args
 */
export async function toolFindSymbol(args) {
  const disabled = await ensureCodeEnabled();
  if (disabled) return disabled;

  const query = String(args?.query ?? args?.symbol ?? '').trim();
  if (!query) return 'Error: query is required.';

  const limit = typeof args?.limit === 'number' ? args.limit : 15;
  const { matches, indexCold, lspError, error } = await findSymbol(query, limit);
  if (error) return `Error: ${error}`;
  if (!matches.length) {
    if (indexCold && lspError) {
      return `Code index is cold and LSP is unavailable (${lspError}). Run repo_map to build the index, or use grep.`;
    }
    if (indexCold) {
      return 'Code index is cold. Run repo_map first, then retry, or use grep.';
    }
    return `No symbols matched "${query}" in the warm index. Try a shorter/exact name, a file-path fragment, repo_map with focus:"<term>", or grep for raw strings.`;
  }

  const lines = matches.map((m) => {
    const loc = `${m.file}:${m.line_start}`;
    return `- **${m.name}** (${m.kind}) — \`${m.id}\` @ ${loc}\n  ${m.signature}`;
  });
  return [`Found ${matches.length} symbol(s) for "${query}":`, '', ...lines].join('\n');
}

/**
 * List incoming call edges (exact graph, not string search).
 * @param {Record<string, unknown>} args
 */
export async function toolWhoCalls(args) {
  const disabled = await ensureCodeEnabled();
  if (disabled) return disabled;

  const symbol = String(args?.symbol ?? '').trim();
  if (!symbol) return 'Error: symbol is required (id or name).';

  const { symbol: row, callers, error } = await whoCalls(symbol);
  if (!row) {
    return (
      error ??
      `Not found: "${symbol}". Pass a symbol id (repo:Qualified.Name from find_symbol), a bare name, or a file path.`
    );
  }

  if (!callers.length) {
    return `No indexed callers for ${row.id} (${row.signature}). Use grep if the index is stale.`;
  }

  const lines = callers.map(
    (c) => `- ${c.signature} @ ${c.file}:${c.line} (\`${c.symbolId}\`)`,
  );
  return [`Callers of ${row.id}:`, '', ...lines].join('\n');
}

/**
 * Read the current source span for a symbol (fresh from disk).
 * @param {Record<string, unknown>} args
 */
export async function toolReadSymbol(args) {
  const disabled = await ensureCodeEnabled();
  if (disabled) return disabled;

  const symbol = String(args?.symbol ?? '').trim();
  if (!symbol) return 'Error: symbol is required (id or name).';

  const { symbol: row, text, error } = await readSymbol(symbol);
  if (!row) {
    return (
      error ??
      `Not found: "${symbol}". Pass a symbol id (repo:Qualified.Name from find_symbol), a bare name, or a file path.`
    );
  }

  return [`# ${row.signature}`, `id: ${row.id}`, `file: ${row.file}:${row.line_start}-${row.line_end}`, '', text].join(
    '\n',
  );
}

/**
 * Reverse lookup: wiki pages that explain a symbol (anchor bridge).
 * @param {Record<string, unknown>} args
 */
export async function toolExplainSymbol(args) {
  const disabled = await ensureCodeEnabled();
  if (disabled) return disabled;

  const symbol = String(args?.symbol ?? '').trim();
  if (!symbol) return 'Error: symbol is required (id or name).';

  const { symbolId, pages, error } = await explainSymbol(symbol);
  if (error) return `Error: ${error}`;
  if (!pages.length) {
    return `No wiki pages anchor ${symbolId ?? symbol}. Try brain_search for prose notes.`;
  }

  const lines = pages.map(
    (p) =>
      `- **${p.title}** — \`${p.path}\`${p.status === 'stale' ? ' _(stale)_' : ''}\n  ${p.summary || '(no summary)'}`,
  );
  return [`Wiki pages explaining ${symbolId}:`, '', ...lines].join('\n');
}
