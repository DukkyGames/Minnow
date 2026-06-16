/**
 * Personalized PageRank over the code-index edge graph.
 */

/** Rough token estimate (chars / 4) for repo-map budgeting. */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

/**
 * Build adjacency lists from edge rows.
 * @param {Array<{ src_symbol: string, dst_symbol: string }>} edges
 * @returns {{ out: Map<string, string[]>, nodes: Set<string> }}
 */
export function buildAdjacency(edges) {
  const out = new Map();
  const nodes = new Set();
  for (const edge of edges) {
    const src = edge.src_symbol;
    const dst = edge.dst_symbol;
    if (!src || !dst) continue;
    nodes.add(src);
    nodes.add(dst);
    const list = out.get(src) ?? [];
    list.push(dst);
    out.set(src, list);
  }
  for (const id of nodes) {
    if (!out.has(id)) out.set(id, []);
  }
  return { out, nodes };
}

/**
 * Deterministic personalized PageRank (no randomness).
 * @param {Map<string, string[]>} outAdj — outgoing neighbors per node
 * @param {Set<string>} nodes
 * @param {Map<string, number>} personalization — must sum to 1 (normalized if not)
 * @param {{ damping?: number, iterations?: number }} [opts]
 * @returns {Map<string, number>}
 */
export function personalizedPageRank(outAdj, nodes, personalization, opts = {}) {
  const damping = opts.damping ?? 0.85;
  const iterations = opts.iterations ?? 25;
  const n = nodes.size;
  if (n === 0) return new Map();

  const uniform = 1 / n;
  const personal = new Map();
  let personalSum = 0;
  for (const id of nodes) {
    const p = personalization.get(id) ?? 0;
    personal.set(id, p);
    personalSum += p;
  }
  if (personalSum <= 0) {
    for (const id of nodes) personal.set(id, uniform);
  } else {
    for (const id of nodes) {
      personal.set(id, (personal.get(id) ?? 0) / personalSum);
    }
  }

  const ranks = new Map();
  for (const id of nodes) ranks.set(id, uniform);

  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Map();
    for (const id of nodes) {
      next.set(id, (1 - damping) * (personal.get(id) ?? uniform));
    }
    for (const [src, neighbors] of outAdj) {
      if (neighbors.length === 0) continue;
      const share = (damping * (ranks.get(src) ?? 0)) / neighbors.length;
      for (const dst of neighbors) {
        next.set(dst, (next.get(dst) ?? 0) + share);
      }
    }
    for (const id of nodes) ranks.set(id, next.get(id) ?? uniform);
  }

  return ranks;
}

/**
 * Build personalization vector biased toward symbols in focus files.
 * @param {Set<string>} nodes
 * @param {Array<{ id: string, file: string, usage_count?: number }>} symbols
 * @param {Set<string>} focusFiles
 */
export function buildPersonalizationVector(nodes, symbols, focusFiles) {
  const weights = new Map();
  const focus = focusFiles && focusFiles.size > 0 ? focusFiles : null;
  for (const sym of symbols) {
    if (!nodes.has(sym.id)) continue;
    let w = 1 + (sym.usage_count ?? 0) * 0.1;
    if (focus && focus.has(sym.file)) w *= 4;
    weights.set(sym.id, w);
  }
  let sum = 0;
  for (const w of weights.values()) sum += w;
  if (sum <= 0) {
    const uniform = 1 / nodes.size;
    for (const id of nodes) weights.set(id, uniform);
    return weights;
  }
  for (const [id, w] of weights) weights.set(id, w / sum);
  return weights;
}
