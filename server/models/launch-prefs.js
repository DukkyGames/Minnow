/**
 * Per-library-model llama.cpp launch prefs in config.json → models.launch.
 *
 * The inspector used to keep drafts in a session Map (`draftSettings`). That
 * vanished on reload, so My Models Load fell back to empty `{}` / planner
 * defaults and the last ctx / ngl / KV choice was lost. These prefs are the
 * durable copy of that draft — same idea as models.inference sampler overrides.
 */

import { getModelsConfig, patchModelsConfig } from './models-config.js';
import { normalizeExtraArgs } from '../../src/models/argv-tokenize.mjs';

/**
 * LlamaServeSettings keys we persist. Unknown keys are dropped so a typo or a
 * future client field cannot poison argv. lastLoadMs / lastWeightsBytes are the
 * Phase 1d time-based load-progress prior (non-goal 7) — not spawn flags.
 */
const LAUNCH_SETTING_KEYS = [
  'fit_mode',
  'ctx',
  'n_gpu_layers',
  'cache_type',
  'parallel',
  'batch_size',
  'ubatch_size',
  'extra_args',
  'env',
  'no_mmap',
  'mlock',
  'chat_template',
  'chat_template_file',
];

const PROGRESS_KEYS = ['lastLoadMs', 'lastWeightsBytes'];

/**
 * @typedef {object} LibraryLaunchSettings
 * @property {'auto' | 'manual'} [fit_mode]
 * @property {number} [ctx]
 * @property {number} [n_gpu_layers]
 * @property {string} [cache_type]
 * @property {number} [parallel]
 * @property {number} [batch_size]
 * @property {number} [ubatch_size]
 * @property {string[]} [extra_args]
 * @property {Record<string, string>} [env]
 * @property {boolean} [no_mmap]
 * @property {boolean} [mlock]
 * @property {string} [chat_template]
 * @property {string} [chat_template_file]
 * @property {number} [lastLoadMs] Wall time of the last successful llama.cpp load.
 * @property {number} [lastWeightsBytes] Weight file size observed for that load.
 */

/**
 * @typedef {object} ModelsLaunchBlock
 * @property {Record<string, LibraryLaunchSettings>} byLibraryId
 */

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function finiteInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function nonNegativeInt(value) {
  const n = finiteInt(value);
  if (n == null || n < 0) return undefined;
  return n;
}

/**
 * Strip progress fields so they never reach buildLlamaServerLaunch / argv.
 * @param {LibraryLaunchSettings | null | undefined} row
 * @returns {LibraryLaunchSettings | undefined}
 */
export function llamaSettingsFromLaunchRow(row) {
  if (!row || typeof row !== 'object') return undefined;
  const llama = normalizeLaunchSettings(row, { includeProgress: false });
  return Object.keys(llama).length > 0 ? llama : undefined;
}

/**
 * Keep only known launch / progress keys with typed values.
 * @param {unknown} raw
 * @param {{ includeProgress?: boolean }} [opts]
 * @returns {LibraryLaunchSettings}
 */
export function normalizeLaunchSettings(raw, opts = {}) {
  const includeProgress = opts.includeProgress !== false;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = /** @type {Record<string, unknown>} */ (raw);
  /** @type {LibraryLaunchSettings} */
  const out = {};

  if (src.fit_mode === 'auto' || src.fit_mode === 'manual') {
    out.fit_mode = src.fit_mode;
  }

  const ctx = finiteInt(src.ctx);
  if (ctx != null && ctx > 0) out.ctx = ctx;

  const ngl = finiteInt(src.n_gpu_layers);
  if (ngl != null && ngl >= 0) out.n_gpu_layers = ngl;

  if (typeof src.cache_type === 'string' && src.cache_type.trim()) {
    out.cache_type = src.cache_type.trim();
  }

  const parallel = finiteInt(src.parallel);
  if (parallel != null && parallel >= 1) out.parallel = parallel;

  const batch = finiteInt(src.batch_size);
  if (batch != null && batch > 0) out.batch_size = batch;

  const ubatch = finiteInt(src.ubatch_size);
  if (ubatch != null && ubatch > 0) out.ubatch_size = ubatch;

  if (typeof src.no_mmap === 'boolean') out.no_mmap = src.no_mmap;
  if (typeof src.mlock === 'boolean') out.mlock = src.mlock;

  if (typeof src.chat_template === 'string' && src.chat_template.trim()) {
    out.chat_template = src.chat_template.trim();
  }
  if (typeof src.chat_template_file === 'string' && src.chat_template_file.trim()) {
    out.chat_template_file = src.chat_template_file.trim();
  }

  const extra = normalizeExtraArgs(src.extra_args);
  if (extra.length) out.extra_args = extra;

  if (src.env && typeof src.env === 'object' && !Array.isArray(src.env)) {
    /** @type {Record<string, string>} */
    const env = {};
    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (src.env))) {
      if (typeof key !== 'string' || !key.trim()) continue;
      if (typeof value !== 'string') continue;
      env[key] = value;
    }
    if (Object.keys(env).length) out.env = env;
  }

  if (includeProgress) {
    const lastLoadMs = nonNegativeInt(src.lastLoadMs);
    if (lastLoadMs != null) out.lastLoadMs = lastLoadMs;
    const lastWeightsBytes = nonNegativeInt(src.lastWeightsBytes);
    if (lastWeightsBytes != null) out.lastWeightsBytes = lastWeightsBytes;
  }

  return out;
}

/**
 * Later layers win. Drops lastLoadMs / lastWeightsBytes so they never become argv.
 * Does **not** run the persist whitelist — request bodies still carry `fit`,
 * `no_warmup`, split flags, etc.
 * @param {...(Record<string, unknown> | null | undefined)} layers
 * @returns {LibraryLaunchSettings}
 */
export function mergeLaunchSettings(...layers) {
  /** @type {LibraryLaunchSettings} */
  const out = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) {
      if (PROGRESS_KEYS.includes(key)) continue;
      if (value !== undefined && value !== null) {
        out[/** @type {keyof LibraryLaunchSettings} */ (key)] = value;
      }
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {ModelsLaunchBlock}
 */
export function normalizeLaunchBlock(raw) {
  const block = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const byLibraryId =
    block.byLibraryId && typeof block.byLibraryId === 'object'
      ? /** @type {Record<string, unknown>} */ (block.byLibraryId)
      : {};

  /** @type {Record<string, LibraryLaunchSettings>} */
  const cleanedById = {};
  for (const [libraryId, settings] of Object.entries(byLibraryId)) {
    if (typeof libraryId !== 'string' || !libraryId.trim()) continue;
    const normalized = normalizeLaunchSettings(settings, { includeProgress: true });
    if (Object.keys(normalized).length > 0) {
      cleanedById[libraryId] = normalized;
    }
  }

  return { byLibraryId: cleanedById };
}

/**
 * @returns {Promise<ModelsLaunchBlock>}
 */
export async function getLaunchPrefs() {
  const models = await getModelsConfig();
  return normalizeLaunchBlock(models.launch);
}

/**
 * Replace the launch-settings slice for one library row. `null` or an empty
 * object deletes the row (including the load-progress prior). Progress fields
 * already on the row are kept when the incoming payload omits them, so a slider
 * save cannot wipe lastLoadMs.
 *
 * @param {string} libraryId
 * @param {LibraryLaunchSettings | null} settings
 * @returns {Promise<ModelsLaunchBlock>}
 */
export async function setLibraryLaunchSettings(libraryId, settings) {
  const id = typeof libraryId === 'string' ? libraryId.trim() : '';
  if (!id) {
    throw new Error('libraryId is required');
  }

  const models = await getModelsConfig();
  const launch = normalizeLaunchBlock(models.launch);
  const existing = launch.byLibraryId[id];

  if (settings === null) {
    delete launch.byLibraryId[id];
    await patchModelsConfig({ launch });
    return launch;
  }

  const normalized = normalizeLaunchSettings(settings, { includeProgress: true });
  // Empty object / no known keys: delete, matching inference-prefs clearing.
  if (Object.keys(normalized).length === 0) {
    delete launch.byLibraryId[id];
    await patchModelsConfig({ launch });
    return launch;
  }

  /** @type {LibraryLaunchSettings} */
  const next = { ...normalized };
  // Preserve the load-progress prior unless this write is itself a prior update.
  if (existing) {
    if (next.lastLoadMs == null && existing.lastLoadMs != null) next.lastLoadMs = existing.lastLoadMs;
    if (next.lastWeightsBytes == null && existing.lastWeightsBytes != null) {
      next.lastWeightsBytes = existing.lastWeightsBytes;
    }
  }

  launch.byLibraryId[id] = next;
  await patchModelsConfig({ launch });
  return launch;
}

/**
 * Record how long a llama.cpp serve took to reach `running`, plus the weights
 * size used for that load. Creates a progress-only row when the user never
 * touched inspector sliders.
 *
 * @param {string} libraryId
 * @param {{ lastLoadMs: number, lastWeightsBytes: number }} prior
 * @returns {Promise<ModelsLaunchBlock>}
 */
export async function recordLaunchLoadPrior(libraryId, prior) {
  const id = typeof libraryId === 'string' ? libraryId.trim() : '';
  if (!id) {
    throw new Error('libraryId is required');
  }

  const models = await getModelsConfig();
  const launch = normalizeLaunchBlock(models.launch);
  const existing = launch.byLibraryId[id] ?? {};
  const lastLoadMs = nonNegativeInt(prior?.lastLoadMs);
  const lastWeightsBytes = nonNegativeInt(prior?.lastWeightsBytes);

  /** @type {LibraryLaunchSettings} */
  const next = { ...existing };
  if (lastLoadMs != null) next.lastLoadMs = lastLoadMs;
  if (lastWeightsBytes != null) next.lastWeightsBytes = lastWeightsBytes;

  if (Object.keys(next).length === 0) {
    return launch;
  }

  launch.byLibraryId[id] = next;
  await patchModelsConfig({ launch });
  return launch;
}

export { LAUNCH_SETTING_KEYS, PROGRESS_KEYS };
