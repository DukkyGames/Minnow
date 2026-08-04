/**
 * Live Hugging Face Hub model search for Discover.
 *
 * One upstream call answers everything the card needs. `expand[]` returns the
 * parsed config, tensor totals, and gating status, so there is no per-repo tree
 * probe and no HEAD request to size a download.
 */

import { resolveHfTokenAsync } from './hf-client.js';
import { isMlxSupported, MLX_UNSUPPORTED_MESSAGE } from '../servers/mlx-lm.js';
import { validateRepoId } from './validate.js';

/** Hub pipeline tags mlx-lm cannot serve (those are mlx-vlm's job). */
const UNSERVABLE_PIPELINE_TAGS = new Set(['image-text-to-text', 'image-to-text', 'visual-question-answering']);

const CACHE_TTL_MS = 60_000;
const MAX_LIMIT = 48;
const DEFAULT_LIMIT = 24;

/** @type {Map<string, { at: number, value: object }>} */
const cache = new Map();

/** Swappable for tests. */
let fetchImpl = (...args) => fetch(...args);

/** @param {typeof fetch} fn */
export function setHfSearchFetchForTests(fn) {
  fetchImpl = fn;
}

export function resetHfSearchForTests() {
  fetchImpl = (...args) => fetch(...args);
  cache.clear();
}

/**
 * Bytes per element for the dtypes the Hub reports in `safetensors.parameters`.
 * MLX packs quantized weights into U32 words, which is why a 4-bit repo shows a
 * large U32 count rather than a 4-bit one.
 */
const DTYPE_BYTES = {
  F64: 8,
  I64: 8,
  U64: 8,
  F32: 4,
  I32: 4,
  U32: 4,
  BF16: 2,
  F16: 2,
  I16: 2,
  U16: 2,
  F8_E4M3: 1,
  F8_E5M2: 1,
  I8: 1,
  U8: 1,
  BOOL: 1,
};

/**
 * Repo size from the per-dtype element counts.
 *
 * Not `safetensors.total`, despite the name: that field is a *count of stored
 * elements*, not a byte total, and on some repos it does not even match the sum
 * of the per-dtype counts. Weighting each count by its dtype width reproduces
 * the real on-disk size (verified against 8-bit MLX repos).
 *
 * @param {Record<string, any> | undefined} safetensors
 * @returns {number | null}
 */
function tensorBytes(safetensors) {
  const parameters = safetensors?.parameters;
  if (!parameters || typeof parameters !== 'object') return null;
  let bytes = 0;
  let matched = false;
  for (const [dtype, count] of Object.entries(parameters)) {
    const n = Number(count);
    const width = DTYPE_BYTES[String(dtype).toUpperCase()];
    if (!Number.isFinite(n) || n <= 0 || width == null) continue;
    bytes += n * width;
    matched = true;
  }
  return matched ? Math.round(bytes) : null;
}

/**
 * Params from a repo name.
 *
 * The primary signal, not a fallback. For a quantized repo the Hub's element
 * counts describe *packed storage*, so an 8B 4-bit model reports ~1.28B
 * elements — reading that as a parameter count would understate every quantized
 * model by the quantization ratio. The publisher's own "-8B-" is correct.
 *
 * @param {string} name
 * @returns {number | null}
 */
function inferParamsFromName(name) {
  const match = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/i.exec(name);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value < 2000 ? value : null;
}

/**
 * @param {Record<string, unknown> | undefined} config
 * @param {string} format
 * @param {string} repoId
 */
function resolveQuant(config, format, repoId) {
  if (format !== 'mlx') return '';

  const quantization = config?.quantization;
  const quantConfig = config?.quantization_config;
  const bits =
    quantization && typeof quantization === 'object' && Number.isFinite(Number(quantization.bits))
      ? Number(quantization.bits)
      : quantConfig &&
          typeof quantConfig === 'object' &&
          Number.isFinite(Number(quantConfig.bits))
        ? Number(quantConfig.bits)
        : NaN;
  if (Number.isFinite(bits) && bits > 0) return `mlx-${bits}bit`;

  // Fall back to the name, which mlx-community reliably suffixes.
  const named = /(\d+)\s*bit/i.exec(repoId);
  return named ? `mlx-${named[1]}bit` : '';
}

/**
 * @param {Record<string, unknown> | undefined} config
 * @param {string} repoId
 */
function resolveArch(config, repoId) {
  if (typeof config?.model_type === 'string' && config.model_type) return config.model_type;
  const architectures = config?.architectures;
  if (Array.isArray(architectures) && typeof architectures[0] === 'string') {
    return architectures[0];
  }
  const tail = repoId.split('/').pop() ?? repoId;
  return tail.split(/[-_.]/)[0] ?? '';
}

/**
 * Map one Hub row to the DTO Discover renders.
 *
 * Exported because it is where every field-shape assumption lives, and it is
 * pure — so its behaviour stays testable on machines that cannot run MLX.
 * @param {Record<string, any>} row
 * @param {string} format
 */
export function mapHubRow(row, format) {
  const repoId = String(row.id ?? row.modelId ?? '');
  const config = row.config && typeof row.config === 'object' ? row.config : undefined;
  const safetensors =
    row.safetensors && typeof row.safetensors === 'object' ? row.safetensors : undefined;

  const quant = resolveQuant(config, format, repoId);
  const named = inferParamsFromName(repoId);
  const declaredTotal = Number(safetensors?.total);
  // Element counts only equal parameter counts when nothing is packed, so the
  // Hub total is a last resort and only for unquantized repos.
  const paramsB =
    named ??
    (!quant && Number.isFinite(declaredTotal) && declaredTotal > 0
      ? Number((declaredTotal / 1e9).toFixed(2))
      : null);

  const template = typeof config?.chat_template_jinja === 'string' ? config.chat_template_jinja : '';

  return {
    repoId,
    format,
    quant,
    arch: resolveArch(config, repoId),
    paramsB,
    sizeBytes: tensorBytes(safetensors),
    downloads: Number(row.downloads) || 0,
    likes: Number(row.likes) || 0,
    // The Hub returns false | "auto" | "manual"; anything truthy needs a token.
    gated: Boolean(row.gated),
    toolCapable: /\btools?\b/.test(template),
    pipelineTag: typeof row.pipeline_tag === 'string' ? row.pipeline_tag : '',
  };
}

/**
 * @param {{ query?: string, format?: string, limit?: number, sort?: string }} options
 * @returns {Promise<{ results: object[], reason: string | null, hasToken: boolean }>}
 */
export async function searchHubModels(options = {}) {
  const format = options.format === 'mlx' ? 'mlx' : 'gguf';
  const query = typeof options.query === 'string' ? options.query.trim().slice(0, 120) : '';
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(requested)))
    : DEFAULT_LIMIT;
  const sort = ['downloads', 'likes', 'lastModified'].includes(String(options.sort))
    ? String(options.sort)
    : 'downloads';

  const token = await resolveHfTokenAsync().catch(() => '');
  const hasToken = Boolean(token);

  // Refused here rather than at the download: letting someone pick a 20 GB repo
  // that can never load on their machine is the worse failure.
  if (format === 'mlx' && !isMlxSupported()) {
    return { results: [], reason: MLX_UNSUPPORTED_MESSAGE, hasToken };
  }

  const cacheKey = `${format}:${sort}:${limit}:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.value, hasToken };
  }

  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.append('filter', format);
  url.searchParams.append('filter', 'text-generation');
  if (query) url.searchParams.set('search', query);
  url.searchParams.set('sort', sort);
  url.searchParams.set('direction', '-1');
  // Over-fetch so server-side VLM filtering cannot return a short page.
  url.searchParams.set('limit', String(Math.min(MAX_LIMIT * 2, limit * 2)));
  for (const field of ['config', 'safetensors', 'downloads', 'likes', 'gated', 'tags', 'pipeline_tag']) {
    url.searchParams.append('expand[]', field);
  }

  const headers = { 'User-Agent': 'Minnow/1.0' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchImpl(url.toString(), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Hugging Face search failed (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    return { results: [], reason: null, hasToken };
  }

  const results = [];
  for (const row of data) {
    if (results.length >= limit) break;
    if (!row || typeof row !== 'object') continue;

    const rawId = String(row.id ?? row.modelId ?? '');
    // Every id here reaches the download path, so it passes the same validator.
    try {
      validateRepoId(rawId);
    } catch {
      continue;
    }

    const pipelineTag = typeof row.pipeline_tag === 'string' ? row.pipeline_tag : '';
    if (UNSERVABLE_PIPELINE_TAGS.has(pipelineTag)) continue;

    results.push(mapHubRow(row, format));
  }

  const value = { results, reason: null };
  cache.set(cacheKey, { at: Date.now(), value });
  // Bound the cache; these are small objects but the key space is user input.
  if (cache.size > 64) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }

  return { ...value, hasToken };
}
