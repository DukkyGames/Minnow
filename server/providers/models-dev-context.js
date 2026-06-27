/**
 * OpenCode Zen / Go model lists omit context_length on /v1/models.
 * OpenCode resolves limits from models.dev — mirror that for Minnow catalog rows.
 */

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_TIMEOUT_MS = 20_000;
/** Refresh catalog daily; limits change infrequently. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** @type {{ fetchedAt: number, models: Record<string, { limit?: { context?: number } }> | null }} */
const cache = { fetchedAt: 0, models: null };

/**
 * @param {string} baseUrl
 */
export function isOpenCodeProviderBaseUrl(baseUrl) {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'opencode.ai' || host.endsWith('.opencode.ai');
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<Record<string, { limit?: { context?: number } }>>}
 */
async function loadOpenCodeModelsDevCatalog() {
  const now = Date.now();
  if (cache.models && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`models.dev HTTP ${res.status}`);
    }
    const json = await res.json();
    const models =
      json?.opencode?.models && typeof json.opencode.models === 'object'
        ? /** @type {Record<string, { limit?: { context?: number } }>} */ (json.opencode.models)
        : {};
    cache.fetchedAt = now;
    cache.models = models;
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attach max_context_length from models.dev when OpenCode upstream omits it.
 * Exact model id match only — authoritative for opencode.ai providers.
 *
 * @param {{ data: Array<{ id: string, max_context_length?: number, [key: string]: unknown }> }} normalized
 */
export async function enrichOpenCodeModelsFromModelsDev(normalized) {
  if (!normalized?.data?.length) {
    return normalized;
  }

  let catalog;
  try {
    catalog = await loadOpenCodeModelsDevCatalog();
  } catch (err) {
    console.warn('[providers] models.dev context enrichment failed:', err?.message || err);
    return normalized;
  }

  const data = normalized.data.map((row) => {
    const devLimit = catalog[row.id]?.limit?.context;
    if (typeof devLimit !== 'number' || !Number.isFinite(devLimit) || devLimit <= 0) {
      return row;
    }
    return { ...row, max_context_length: devLimit };
  });

  return { data };
}

/** Test hook: reset in-memory models.dev cache. */
export function resetModelsDevContextCacheForTests() {
  cache.fetchedAt = 0;
  cache.models = null;
}
