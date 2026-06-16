/**
 * Default settings for the Brain code index (config.brain.code.*).
 */

/** @typedef {'on-demand' | 'on-switch' | 'git-hook'} CodeReindexCadence */

export const DEFAULT_BRAIN_CODE_CONFIG = {
  enabled: true,
  includeGlobs: [
    '**/*.{ts,tsx,js,jsx,mjs,cjs,py,rs,go,java,kt,rb,php,cs,swift}',
    '**/*.{fake}',
  ],
  excludeGlobs: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.minnow/**',
  ],
  /** Approximate token budget for repo_map output. */
  repoMapTokenBudget: 1500,
  /** When to trigger background reindex (MIN-B10 wires automation). */
  reindexCadence: /** @type {CodeReindexCadence} */ ('on-demand'),
  /** Reserved for MIN-B11 semantic code search. */
  codeEmbeddingsEnabled: false,
  /** Write .minnow/brain-jsconfig.json when a JS/TS workspace has no ts/js config. */
  autoScaffoldIndexConfig: true,
};

/**
 * Merge partial code-index settings with defaults.
 * @param {Record<string, unknown> | undefined | null} raw
 */
export function normalizeBrainCodeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const includeGlobs = Array.isArray(src.includeGlobs)
    ? src.includeGlobs.map((g) => String(g).trim()).filter(Boolean)
    : DEFAULT_BRAIN_CODE_CONFIG.includeGlobs;
  const excludeGlobs = Array.isArray(src.excludeGlobs)
    ? src.excludeGlobs.map((g) => String(g).trim()).filter(Boolean)
    : DEFAULT_BRAIN_CODE_CONFIG.excludeGlobs;
  const cadence = String(src.reindexCadence ?? DEFAULT_BRAIN_CODE_CONFIG.reindexCadence);
  const validCadence =
    cadence === 'on-switch' || cadence === 'git-hook' ? cadence : 'on-demand';
  const budget = Number(src.repoMapTokenBudget ?? DEFAULT_BRAIN_CODE_CONFIG.repoMapTokenBudget);
  return {
    ...DEFAULT_BRAIN_CODE_CONFIG,
    enabled: src.enabled !== false,
    includeGlobs,
    excludeGlobs,
    repoMapTokenBudget: Number.isFinite(budget)
      ? Math.min(8000, Math.max(200, Math.floor(budget)))
      : DEFAULT_BRAIN_CODE_CONFIG.repoMapTokenBudget,
    reindexCadence: validCadence,
    codeEmbeddingsEnabled: src.codeEmbeddingsEnabled === true,
    autoScaffoldIndexConfig: src.autoScaffoldIndexConfig !== false,
  };
}
