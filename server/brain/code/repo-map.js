/**
 * Token-budgeted repo map rendering from ranked symbols.
 */

import { estimateTokens } from './rank.js';

/**
 * Render signature-only lines until the token budget is exhausted.
 * @param {Array<{
 *   id: string,
 *   file: string,
 *   signature: string,
 *   pagerank?: number,
 *   kind?: string,
 * }>} symbols — pre-sorted by rank descending
 * @param {number} tokenBudget
 * @param {{ focus?: string }} [opts]
 */
export function renderRepoMap(symbols, tokenBudget, opts = {}) {
  const budget = Math.max(50, Math.floor(tokenBudget));
  const lines = [];
  let used = 0;
  const focus = opts.focus?.trim().toLowerCase();

  if (focus) {
    lines.push(`# Repo map (focus: ${opts.focus})`);
    used += estimateTokens(lines[0]);
  } else {
    lines.push('# Repo map');
    used += estimateTokens(lines[0]);
  }

  const byFile = new Map();
  for (const sym of symbols) {
    if (focus) {
      const hay = `${sym.id} ${sym.file} ${sym.signature}`.toLowerCase();
      if (!hay.includes(focus)) continue;
    }
    const list = byFile.get(sym.file) ?? [];
    list.push(sym);
    byFile.set(sym.file, list);
  }

  const files = [...byFile.keys()].sort();
  for (const file of files) {
    const header = `\n## ${file}`;
    const headerTokens = estimateTokens(header);
    if (used + headerTokens > budget) break;
    lines.push(header);
    used += headerTokens;

    for (const sym of byFile.get(file) ?? []) {
      const sig = sym.signature?.trim() || `${sym.kind ?? 'symbol'} ${sym.id}`;
      const line = `- ${sig}`;
      const lineTokens = estimateTokens(line);
      if (used + lineTokens > budget) {
        lines.push('- … (truncated to token budget)');
        return { text: lines.join('\n'), truncated: true, tokenEstimate: used };
      }
      lines.push(line);
      used += lineTokens;
    }
  }

  if (lines.length === 1) {
    lines.push('\n(no indexed symbols — run reindex or use grep)');
  }

  return { text: lines.join('\n'), truncated: false, tokenEstimate: used };
}
