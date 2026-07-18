/**
 * Thresholds governing `similarTo` edges and page retirement.
 *
 * Lives in its own module so both the config store and the synthesis pipeline
 * share one set of defaults and one clamp.
 */

/** Default brain.linking block. */
export const DEFAULT_LINKING_CONFIG = {
  /** Shared title keywords required to link two pages on title overlap alone. */
  minSharedTitleKeywords: 2,
  /** Cosine similarity that qualifies a page for a `similarTo` edge on its own. */
  minCosine: 0.75,
  /** Cosine required to retire a page as superseded — above minCosine on purpose. */
  retireMinCosine: 0.85,
  /** Hard cap on `similarTo` entries written for one page. */
  maxLinks: 3,
};

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampUnit(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/**
 * Merge raw user linking settings over the defaults, clamping each field.
 * @param {unknown} raw
 * @param {Partial<typeof DEFAULT_LINKING_CONFIG>} [existing]
 * @returns {typeof DEFAULT_LINKING_CONFIG}
 */
export function normalizeLinkingConfig(raw, existing = {}) {
  const base = { ...DEFAULT_LINKING_CONFIG, ...existing };
  const row =
    raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};

  return {
    minSharedTitleKeywords: clampInt(
      row.minSharedTitleKeywords,
      base.minSharedTitleKeywords,
      1,
      6,
    ),
    minCosine: clampUnit(row.minCosine, base.minCosine),
    retireMinCosine: clampUnit(row.retireMinCosine, base.retireMinCosine),
    maxLinks: clampInt(row.maxLinks, base.maxLinks, 0, 10),
  };
}
