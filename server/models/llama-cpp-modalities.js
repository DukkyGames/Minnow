/**
 * llama.cpp `/props` → catalog vision flag for Minnow-hosted models.
 *
 * `llama-server`'s `/v1/models` is a bare `{ id }` list, so a Minnow-hosted GGUF
 * used to fall through to an id regex — meaning a VLM whose name lacks "vl" or
 * "vision" (gemma-3, qwen2-audio, most fine-tunes) silently lost its images.
 * `/props` reports what the *running* process actually loaded, which also covers
 * the case where `--mmproj` was passed but the projector failed to load.
 */

const PROPS_TIMEOUT_MS = 5_000;

/**
 * Read `modalities.vision` from a llama.cpp `/props` payload.
 * Returns undefined for builds predating the field — never a guess.
 *
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
 * @param {string} baseUrl
 * @param {Record<string, string>} headers
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<boolean | undefined>}
 */
async function fetchLlamaVisionFlag(baseUrl, headers, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROPS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${baseUrl}/props`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    return visionFromLlamaProps(await res.json());
  } catch {
    // A missing or older `/props` is not evidence either way — leave the row alone.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stamp `catalogVision` on llama.cpp rows from the running server's modalities.
 *
 * One `/props` call covers the whole list: `llama-server` hosts a single model
 * per process, so every row in its `/v1/models` describes that same process.
 *
 * @param {string} baseUrl
 * @param {Record<string, string>} headers
 * @param {{ data: Array<{ id: string, catalogVision?: boolean, [key: string]: unknown }> }} normalized
 * @param {{ fetchImpl?: typeof fetch }} [options] Test seam for the `/props` call.
 */
export async function enrichLlamaCppModelsWithModalities(
  baseUrl,
  headers,
  normalized,
  options = {},
) {
  if (!normalized?.data?.length) return normalized;

  const vision = await fetchLlamaVisionFlag(baseUrl, headers, options.fetchImpl ?? fetch);
  if (vision === undefined) return normalized;

  return {
    data: normalized.data.map((row) =>
      row.catalogVision === undefined ? { ...row, catalogVision: vision } : row,
    ),
  };
}
