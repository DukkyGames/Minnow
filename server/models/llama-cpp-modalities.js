const PROPS_TIMEOUT_MS = 5_000;

/**
 * @param {unknown} json
 * @returns {boolean | undefined}
 */
export function visionFromLlamaProps(json) {
  if (!json || typeof json !== 'object') return undefined;
  const modalities = /** @type {Record<string, unknown>} */ (json).modalities;
  if (!modalities || typeof modalities !== 'object') return undefined;
  const vision = /** @type {Record<string, unknown>} */ (modalities).vision;
  return typeof vision === 'boolean' ? vision : undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/**
 * @param {unknown} json
 * @returns {number | undefined}
 */
export function contextLengthFromLlamaProps(json) {
  if (!json || typeof json !== 'object') return undefined;
  const root = /** @type {Record<string, unknown>} */ (json);

  const defaults = root.default_generation_settings;
  if (defaults && typeof defaults === 'object') {
    const perSlot = positiveInt(/** @type {Record<string, unknown>} */ (defaults).n_ctx);
    if (perSlot !== undefined) return perSlot;
  }

  const total = positiveInt(root.n_ctx);
  if (total === undefined) return undefined;
  const slots = positiveInt(root.total_slots) ?? 1;
  return Math.floor(total / slots) || undefined;
}

/**
 * @param {string} baseUrl
 * @param {Record<string, string>} headers
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<unknown>}
 */
async function fetchLlamaProps(baseUrl, headers, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROPS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}/props`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} baseUrl
 * @param {Record<string, string>} headers
 * @param {{ data: Array<{ id: string, catalogVision?: boolean, [key: string]: unknown }> }} normalized
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function enrichLlamaCppModelsFromProps(
  baseUrl,
  headers,
  normalized,
  options = {},
) {
  if (!normalized?.data?.length) return normalized;

  const props = await fetchLlamaProps(baseUrl, headers, options.fetchImpl ?? fetch);
  if (props === null) return normalized;

  const vision = visionFromLlamaProps(props);
  const contextLength = contextLengthFromLlamaProps(props);
  if (vision === undefined && contextLength === undefined) return normalized;

  return {
    data: normalized.data.map((row) => {
      const next = { ...row };
      if (vision !== undefined && next.catalogVision === undefined) {
        next.catalogVision = vision;
      }
      if (contextLength !== undefined) {
        next.loaded_context_length = contextLength;
      }
      return next;
    }),
  };
}
