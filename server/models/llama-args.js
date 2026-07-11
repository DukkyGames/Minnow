/**
 * Centralized llama-server CLI argument builder.
 * Merges hardware profiles, user dialog settings, and ~/.minnow/llama-cpp.json defaults.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { computeServeProfiles } from './profiles.js';
import { isGpuCapableVariant } from './llama-variant.js';

/** @typedef {import('./llama-variant.js').LlamaVariant} LlamaVariant */

/**
 * @typedef {object} LlamaServeSettings
 * @property {number} [ctx]
 * @property {number} [n_gpu_layers]
 * @property {string} [cache_type]
 * @property {number} [n_cpu_moe]
 * @property {number} [batch_size]
 * @property {number} [ubatch_size]
 * @property {number} [parallel]
 * @property {string} [split_mode]
 * @property {string} [tensor_split]
 * @property {number} [main_gpu]
 * @property {boolean} [fit]
 * @property {boolean} [no_warmup]
 * @property {string[]} [extra_args]
 * @property {Record<string, string>} [env]
 */

/** Path to saved default launch settings. */
export function getLlamaCppConfigPath() {
  return path.join(getMinnowHome(), 'llama-cpp.json');
}

/**
 * Read persisted default llama serve settings.
 * @returns {Promise<{ variant?: LlamaVariant, defaults?: LlamaServeSettings }>}
 */
export async function readLlamaCppConfig() {
  try {
    const raw = await fsp.readFile(getLlamaCppConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} patch
 */
export async function writeLlamaCppConfig(patch) {
  const prev = await readLlamaCppConfig();
  const next = { ...prev, ...patch };
  await fsp.mkdir(path.dirname(getLlamaCppConfigPath()), { recursive: true });
  await fsp.writeFile(getLlamaCppConfigPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/**
 * Merge settings objects — later keys win.
 * @param {...LlamaServeSettings | null | undefined} layers
 * @returns {LlamaServeSettings}
 */
function mergeSettings(...layers) {
  /** @type {LlamaServeSettings} */
  const out = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined && value !== null) {
        out[/** @type {keyof LlamaServeSettings} */ (key)] = value;
      }
    }
  }
  return out;
}

/**
 * Build llama-server argv from profile, settings, and hardware snapshot.
 * @param {object} opts
 * @param {string} opts.modelPath
 * @param {number} opts.port
 * @param {string} [opts.profileKey]
 * @param {Record<string, unknown>} [opts.hardware]
 * @param {Record<string, unknown>} [opts.modelMeta]
 * @param {LlamaServeSettings} [opts.settings]
 * @param {LlamaServeSettings} [opts.defaults]
 * @param {LlamaVariant} [opts.variant]
 * @returns {string[]}
 */
export function buildLlamaServerArgs(opts) {
  const {
    modelPath,
    port,
    profileKey = 'balanced',
    hardware,
    modelMeta = {},
    settings,
    defaults,
    variant = 'cpu',
  } = opts;

  /** @type {LlamaServeSettings} */
  let profileSettings = {};

  if (hardware && typeof hardware === 'object') {
    const profiles = computeServeProfiles(hardware, modelMeta, {
      serveWeightsGb: modelMeta.serveWeightsGb,
      serveQuant: modelMeta.serveQuant,
    });
    const profile = profiles.find((p) => p.key === profileKey) || profiles[1] || profiles[0];
    if (profile) {
      profileSettings = {
        ctx: profile.ctx,
        n_gpu_layers: profile.n_gpu_layers,
        cache_type: profile.cache_type,
        n_cpu_moe: profile.n_cpu_moe,
      };
    }
  }

  const merged = mergeSettings(profileSettings, defaults, settings);

  // GPU layers: force CPU when variant is CPU-only; default all layers on GPU builds.
  if (!isGpuCapableVariant(variant)) {
    merged.n_gpu_layers = 0;
  } else if (merged.n_gpu_layers === undefined || merged.n_gpu_layers === null) {
    merged.n_gpu_layers = 999;
  }

  const args = [
    '-m',
    modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ];

  if (merged.ctx != null) {
    args.push('-c', String(merged.ctx));
  }

  if (merged.n_gpu_layers != null) {
    args.push('-ngl', String(merged.n_gpu_layers));
  }

  if (merged.cache_type && merged.cache_type !== 'f16') {
    args.push('--cache-type-k', merged.cache_type, '--cache-type-v', merged.cache_type);
  }

  if (merged.n_cpu_moe != null && merged.n_cpu_moe > 0) {
    args.push('--n-cpu-moe', String(merged.n_cpu_moe));
  }

  if (merged.batch_size != null) {
    args.push('-b', String(merged.batch_size));
  }

  if (merged.ubatch_size != null) {
    args.push('-ub', String(merged.ubatch_size));
  }

  if (merged.parallel != null) {
    args.push('--parallel', String(merged.parallel));
  }

  if (merged.split_mode) {
    args.push('--split-mode', merged.split_mode);
  }

  if (merged.tensor_split) {
    args.push('--tensor-split', merged.tensor_split);
  }

  if (merged.main_gpu != null) {
    args.push('--main-gpu', String(merged.main_gpu));
  }

  // llama-server expects `--fit on|off`, not a bare boolean flag.
  if (merged.fit === true) {
    args.push('--fit', 'on');
  } else if (merged.fit === false) {
    args.push('--fit', 'off');
  }

  if (merged.no_warmup === true) {
    args.push('--no-warmup');
  }

  if (Array.isArray(merged.extra_args)) {
    for (const token of merged.extra_args) {
      if (typeof token === 'string' && token.trim()) {
        args.push(token.trim());
      }
    }
  }

  return args;
}

/**
 * Merge spawn env with user-provided llama env flags.
 * @param {string} binaryPath
 * @param {LlamaServeSettings} [settings]
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @param {(binaryPath: string, baseEnv?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv} buildBaseEnv
 */
export function buildLlamaServerSpawnEnv(binaryPath, settings, baseEnv, buildBaseEnv) {
  const env = buildBaseEnv(binaryPath, baseEnv);
  if (settings?.env && typeof settings.env === 'object') {
    Object.assign(env, settings.env);
  }
  return env;
}
