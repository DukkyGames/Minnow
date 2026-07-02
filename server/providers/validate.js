/**
 * Provider id, URL, and enum validation for ~/.minnow/providers.
 */

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const API_KINDS = new Set(['lm-studio-v0', 'openai-v1', 'anthropic-v1']);
const AUTH_STYLES = new Set(['bearer', 'api-key', 'x-api-key']);

/**
 * @param {string} id
 * @returns {string}
 */
export function validateProviderId(id) {
  if (typeof id !== 'string' || !PROVIDER_ID_RE.test(id)) {
    throw new Error('Invalid provider id');
  }
  return id;
}

/**
 * Normalize base URL to origin without trailing slash.
 * @param {string} raw
 * @returns {string}
 */
export function validateBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('baseUrl is required');
  }
  const trimmed = raw.trim().replace(/\/$/, '');
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('Invalid baseUrl');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }
  return u.origin;
}

/**
 * @param {string} apiKind
 * @returns {'lm-studio-v0' | 'openai-v1' | 'anthropic-v1'}
 */
export function validateApiKind(apiKind) {
  if (!API_KINDS.has(apiKind)) {
    throw new Error('Invalid apiKind');
  }
  return /** @type {'lm-studio-v0' | 'openai-v1' | 'anthropic-v1'} */ (apiKind);
}

/**
 * @param {string | undefined} style
 * @returns {'bearer' | 'api-key' | 'x-api-key'}
 */
export function validateAuthStyle(style) {
  if (!style) return 'bearer';
  if (!AUTH_STYLES.has(style)) {
    throw new Error('Invalid authStyle');
  }
  return /** @type {'bearer' | 'api-key' | 'x-api-key'} */ (style);
}

/**
 * @param {string} pathnameSegment
 * @returns {boolean}
 */
export function isSafeProviderPathSegment(pathnameSegment) {
  return typeof pathnameSegment === 'string' && PROVIDER_ID_RE.test(pathnameSegment);
}

/**
 * @param {unknown} raw
 * @returns {object | null}
 */
function normalizeModelRates(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const inputPer1M = Number(raw.inputPer1M);
  const outputPer1M = Number(raw.outputPer1M);
  if (!Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) return null;
  if (inputPer1M < 0 || outputPer1M < 0) return null;
  return { inputPer1M, outputPer1M };
}

/**
 * Validate optional pricing block on provider profile.
 * @param {unknown} raw
 * @returns {object | null | undefined} normalized object, null to clear, undefined to omit
 */
export function validateProviderPricing(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid pricing');
  }
  const out = {};
  if (typeof raw.currency === 'string' && raw.currency.trim()) {
    out.currency = raw.currency.trim().toUpperCase();
  }
  const defaultRates = normalizeModelRates(raw.default);
  if (defaultRates) out.default = defaultRates;
  if (raw.models && typeof raw.models === 'object') {
    const models = {};
    for (const [key, value] of Object.entries(raw.models)) {
      if (typeof key !== 'string' || !key.trim()) continue;
      const rates = normalizeModelRates(value);
      if (rates) models[key.trim()] = rates;
    }
    if (Object.keys(models).length > 0) out.models = models;
  }
  if (!out.default && !out.models) {
    throw new Error('pricing requires default or models rates');
  }
  return out;
}
