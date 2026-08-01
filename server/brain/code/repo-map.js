/**
 * Token-budgeted repo map rendering from ranked symbols.
 */

import { estimateTokens } from './rank.js';
import { formatRepoMapInjectionLine, formatRepoMapSymbolLine } from './repo-map-symbols.js';

/**
 * Render signature-only lines until the token budget is exhausted.
 * Symbols must be pre-sorted by rank (pagerank DESC) — output follows that order
 * so high-value symbols are not displaced by alphabetical file sorting.
 * @param {Array<{
 *   id: string,
 *   file: string,
 *   signature: string,
 *   pagerank?: number,
 *   kind?: string,
 *   line_start?: number,
 * }>} symbols — pre-sorted by rank descending
 * @param {number} tokenBudget
 * @param {{ focus?: string, profile?: 'default' | 'injection' }} [opts]
 */
export function renderRepoMap(symbols, tokenBudget, opts = {}) {
  const budget = Math.max(50, Math.floor(tokenBudget));
  const profile = opts.profile === 'injection' ? 'injection' : 'default';
  const lines = [];
  /** @type {Array<{ type: string, text: string, symbolId?: string, file?: string }>} */
  const entries = [];
  let used = 0;
  const focus = opts.focus?.trim().toLowerCase();

  const title = focus ? `# Repo map (focus: ${opts.focus})` : '# Repo map';
  lines.push(title);
  entries.push({ type: 'title', text: title });
  used += estimateTokens(title);

  let currentFile = null;
  let matched = 0;

  for (const sym of symbols) {
    if (focus) {
      const hay = `${sym.id} ${sym.file} ${sym.signature}`.toLowerCase();
      if (!hay.includes(focus)) continue;
    }
    matched += 1;

    if (profile !== 'injection' && sym.file !== currentFile) {
      currentFile = sym.file;
      const header = `\n## ${currentFile}`;
      const headerTokens = estimateTokens(header);
      if (used + headerTokens > budget) break;
      lines.push(header);
      entries.push({ type: 'file', file: currentFile, text: `## ${currentFile}` });
      used += headerTokens;
    }

    const line =
      profile === 'injection' ? formatRepoMapInjectionLine(sym) : formatRepoMapSymbolLine(sym);
    const lineTokens = estimateTokens(line);
    if (used + lineTokens > budget) {
      const truncatedLine = '- … (truncated to token budget)';
      lines.push(truncatedLine);
      entries.push({ type: 'truncated', text: truncatedLine });
      return {
        text: lines.join('\n'),
        truncated: true,
        tokenEstimate: used,
        entries,
      };
    }
    lines.push(line);
    entries.push({ type: 'symbol', symbolId: sym.id, file: sym.file, text: line });
    used += lineTokens;
  }

  if (matched === 0 && focus) {
    const message = '(no symbols matched focus — try grep or a broader term)';
    lines.push(`\n${message}`);
    entries.push({ type: 'message', text: message });
    return { text: lines.join('\n'), truncated: false, tokenEstimate: used, entries };
  }

  if (lines.length === 1) {
    const message = '(no indexed symbols — run reindex or use grep)';
    lines.push(`\n${message}`);
    entries.push({ type: 'message', text: message });
  }

  return { text: lines.join('\n'), truncated: false, tokenEstimate: used, entries };
}

/**
 * Score how many expected navigation targets appear in the rendered map text.
 * Used by MIN-B11 repo-map benchmarks (higher is better within the same budget).
 * @param {string} mapText
 * @param {string[]} expectedNeedles — symbol names or signatures agents need
 */
export function scoreRepoMapHits(mapText, expectedNeedles) {
  const hay = String(mapText ?? '').toLowerCase();
  let hits = 0;
  for (const needle of expectedNeedles) {
    if (hay.includes(String(needle).toLowerCase())) hits += 1;
  }
  return hits;
}

/**
 * Earliest line index (0-based) where a needle appears, or -1 when absent.
 * @param {string} mapText
 * @param {string} needle
 */
export function firstLineIndexForNeedle(mapText, needle) {
  const lines = String(mapText ?? '').split(/\r?\n/);
  const target = String(needle).toLowerCase();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(target)) return i;
  }
  return -1;
}
