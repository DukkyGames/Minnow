/**
 * Repo-map symbol filtering, ranking, and display formatting.
 * Keeps the map focused on navigable surface area (not LSP leaf noise).
 */

/** Kinds omitted from repo-map output (still indexed for search / call graph). */
export const REPO_MAP_EXCLUDED_KINDS = new Set(['property', 'field', 'variable', 'string']);

/**
 * True when a file should be omitted from repo-map output (still indexed elsewhere).
 * @param {string} file
 */
export function isRepoMapTestPath(file) {
  const f = String(file ?? '').replace(/\\/g, '/').toLowerCase();
  if (!f) return false;
  if (f.startsWith('test/') || f.startsWith('tests/')) return true;
  if (/\/(test|tests|__tests__|fixtures)\//.test(f)) return true;
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)) return true;
  return false;
}

/**
 * Qualified symbol name from a stable id (`repo:Outer.Inner`).
 * @param {string} id
 */
export function qualifiedNameFromSymbolId(id) {
  const raw = String(id ?? '');
  const colon = raw.indexOf(':');
  return colon >= 0 ? raw.slice(colon + 1) : raw;
}

/**
 * Nesting depth from dotted qualified name (0 = top-level).
 * @param {string} qualified
 */
export function symbolNestingDepth(qualified) {
  const q = String(qualified ?? '').trim();
  if (!q) return 0;
  return q.split('.').length - 1;
}

/**
 * Filter and re-rank symbols for repo-map rendering.
 * @param {Array<{
 *   id: string,
 *   file: string,
 *   signature?: string,
 *   kind?: string,
 *   pagerank?: number,
 *   usage_count?: number,
 *   line_start?: number,
 * }>} rows
 */
export function prepareRepoMapSymbols(rows) {
  /** @type {Array<Record<string, unknown>>} */
  const prepared = [];
  for (const sym of rows ?? []) {
    if (isRepoMapTestPath(sym.file)) continue;
    const kind = String(sym.kind ?? 'symbol');
    if (REPO_MAP_EXCLUDED_KINDS.has(kind)) continue;
    const pagerank = Number(sym.pagerank ?? 0);
    const usage = Number(sym.usage_count ?? 0);
    prepared.push({
      ...sym,
      _repoMapScore: pagerank + usage * 0.0001,
    });
  }
  prepared.sort((a, b) => {
    const scoreDelta = (b._repoMapScore ?? 0) - (a._repoMapScore ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    const prDelta = (b.pagerank ?? 0) - (a.pagerank ?? 0);
    if (prDelta !== 0) return prDelta;
    const fileCmp = String(a.file).localeCompare(String(b.file));
    if (fileCmp !== 0) return fileCmp;
    return (a.line_start ?? 0) - (b.line_start ?? 0);
  });
  return prepared.map(({ _repoMapScore, ...sym }) => sym);
}

/**
 * One repo-map bullet with indent + [kind] tag for scanability.
 * @param {{ id: string, signature?: string, kind?: string }} sym
 */
export function formatRepoMapSymbolLine(sym) {
  const qualified = qualifiedNameFromSymbolId(sym.id);
  const depth = symbolNestingDepth(qualified);
  const indent = '  '.repeat(depth);
  const kind = String(sym.kind ?? 'symbol');
  const shortName = qualified.split('.').pop() ?? qualified;
  const rawSig = sym.signature?.trim() || `${kind} ${shortName}`;

  let body = rawSig;
  if (depth > 0) {
    const prefix = `${kind} ${shortName}`;
    if (body.startsWith(prefix)) {
      const tail = body.slice(prefix.length).trim();
      body = tail
        ? `${shortName}${tail.startsWith('(') ? '' : ' '}${tail}`
        : shortName;
    } else {
      body = shortName;
    }
    body = `[${kind}] ${body}`;
  } else if (body.startsWith(`${kind} `)) {
    body = `[${kind}] ${body.slice(kind.length + 1)}`;
  } else if (!body.startsWith('[')) {
    body = `[${kind}] ${body}`;
  }

  return `${indent}- ${body}`;
}
