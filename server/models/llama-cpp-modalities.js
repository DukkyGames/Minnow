/**
 * llama.cpp `/props` → catalog vision flag and live context window for Minnow-hosted models.
 *
 * `llama-server`'s `/v1/models` is a bare `{ id }` list, so a Minnow-hosted GGUF
 * used to fall through to an id regex — meaning a VLM whose name lacks "vl" or
 * "vision" (gemma-3, qwen2-audio, most fine-tunes) silently lost its images, and
 * a model outside the bundled catalog had no context window at all ("Context
 * limit unknown", which also disables compression). `/props` reports what the
 * *running* process actually loaded, which covers both: the case where
 * `--mmproj` was passed but the projector failed to load, and the per-slot
 * context the server was actually started with.
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
 * @param {unknown} value
 * @returns {number | undefined}
 */
function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/**
 * Per-slot context tokens from a llama.cpp `/props` payload.
 *
 * `default_generation_settings.n_ctx` is already `-c ÷ --parallel` — the window a
 * single chat actually gets — so it is preferred over the top-level total that
 * older builds report.
 *
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
 * @returns {Promise<unknown>} Parsed `/props`, or null when unavailable.
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
    // A missing or older `/props` is not evidence either way — leave the row alone.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stamp `catalogVision` and `loaded_context_length` on llama.cpp rows from the
 * running server's own props.
 *
 * One `/props` call covers the whole list: `llama-server` hosts a single model
 * per process, so every row in its `/v1/models` describes that same process.
 *
 * @param {string} baseUrl
 * @param {Record<string, string>} headers
 * @param {{ data: Array<{ id: string, catalogVision?: boolean, [key: string]: unknown }> }} normalized
 * @param {{ fetchImpl?: typeof fetch }} [options] Test seam for the `/props` call.
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
      // The running window beats any catalog max: `-c` is what this process can hold.
      if (contextLength !== undefined) {
        next.loaded_context_length = contextLength;
      }
      return next;
    }),
  };
}
