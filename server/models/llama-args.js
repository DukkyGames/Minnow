/**
 * Centralized llama-server CLI argument builder.
 * Merges hardware profiles, user dialog settings, and ~/.minnow/llama-cpp.json defaults.
 *
 * Auto mode (default): `planLlamaLaunch` owns ctx / n_gpu_layers / cache_type. Argv is
 * `--fit on`, no `-ngl` on GPU, Minnow-sized `-c`. Manual mode (`fit_mode: 'manual'`)
 * passes those three through unclamped and may log a fit-planner over-budget warning.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { estimateRunMemory, GIB } from '../../src/models/memory-model.mjs';
import { geometryFromGgufMetadata, resolveGeometry } from '../../src/models/model-geometry.mjs';
import { normalizeExtraArgs } from '../../src/models/argv-tokenize.mjs';
import {
  CONTEXT_LADDER,
  flashAttnForVariant,
  isCpuLlamaVariant,
  launchBudgetBytes,
  planLlamaLaunch,
  PREFERRED_CONTEXT_TOKENS,
} from '../../src/models/launch-plan.mjs';
import { computeServeProfiles } from './profiles.js';

/** @typedef {import('./llama-variant.js').LlamaVariant} LlamaVariant */
/** @typedef {import('../../src/models/launch-plan.d.mts').LlamaLaunchPlan} LlamaLaunchPlan */

/**
 * llama.cpp `-ngl 999` means "all layers". Auto never emits it; the serve row never stores it.
 * Legacy inspector / profile payloads still send 999 without `fit_mode` — that stays AUTO.
 */
const LEGACY_OFFLOAD_ALL = 999;

/** Manual launches this far over the planner budget get a serve-log warning (Phase 3 greps `fit planner`). */
const FIT_PLANNER_OVERBUDGET_RATIO = 1.25;

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
 * @property {'auto' | 'manual'} [fit_mode] Default `auto`. Planner owns ctx / ngl / cache_type.
 *   `fit: true` (onboarding) is NOT manual.
 * @property {boolean} [no_warmup]
 * @property {boolean} [skip_jinja] Phase 3 load retry after a bad chat template — omit `--jinja`.
 * @property {boolean} [no_mmap] `--no-mmap`; default off. mmap_failed retry also uses extra_args.
 * @property {boolean} [mlock] `--mlock`; default off.
 * @property {string} [chat_template] llama-server `--chat-template` (may contain spaces).
 * @property {string} [chat_template_file] llama-server `--chat-template-file`.
 * @property {string[] | string} [extra_args]
 * @property {Record<string, string>} [env]
 */

/**
 * @typedef {object} LlamaServerLaunch
 * @property {string[]} args
 * @property {LlamaLaunchPlan} plan
 * @property {string | null} warning Serve-log line when manual exceeds budget by >1.25×.
 * @property {LlamaServeSettings} settings Effective planned settings for the serve row.
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
 * llama-server --help: `--fit-target` is MiB per device (comma-separated; a single
 * value broadcasts). Default 1024 MiB. We pass the same reserve `launchBudgetBytes`
 * uses: max(0.9 GiB, 8% of VRAM), converted GiB → MiB.
 * @param {Record<string, unknown> | null | undefined} hardware
 * @param {string} variant
 */
function fitTargetMib(hardware, variant) {
  const gpuVramGb = Number(hardware?.gpuVramGb) || 0;
  if (!isCpuLlamaVariant(variant) && gpuVramGb > 0) {
    const reserveGib = Math.max(0.9, gpuVramGb * 0.08);
    return Math.max(1, Math.round(reserveGib * 1024));
  }
  return 1024;
}

/** @param {object} opts */
function resolveWeightsBytes(opts) {
  if (Number(opts.weightsBytes) > 0) return Number(opts.weightsBytes);
  const gb = Number(opts.modelMeta?.serveWeightsGb);
  if (gb > 0) return gb * GIB;
  return 0;
}

/** @param {Record<string, unknown> | null | undefined} ggufMeta */
function resolveTrainCtx(ggufMeta) {
  const n = Number(ggufMeta?.trainCtx);
  return n > 0 ? Math.trunc(n) : undefined;
}

/** @param {number} bytes */
function gbLabel(bytes) {
  return Math.round((bytes / GIB) * 10) / 10;
}

/**
 * @param {Record<string, unknown>} modelMeta
 * @param {Record<string, unknown> | null | undefined} ggufMeta
 */
function resolveLaunchGeometry(modelMeta, ggufMeta) {
  const exact = ggufMeta ? geometryFromGgufMetadata(ggufMeta) : null;
  if (exact) return exact;
  return resolveGeometry({
    architecture: modelMeta.architecture ?? modelMeta.arch,
    name: modelMeta.name,
    paramsB: modelMeta.parameters_raw ?? modelMeta.params_b ?? modelMeta.paramsB,
    activeParamsB: modelMeta.active_parameters,
  });
}

/**
 * Settings stored on the serve row so Inference is not empty when the client sent {}.
 * Omit n_gpu_layers when unset or 999 — 999 was the old "all layers" sentinel, not a count.
 * @param {LlamaServeSettings} merged
 * @returns {LlamaServeSettings}
 */
function effectiveLlamaSettings(merged) {
  /** @type {LlamaServeSettings} */
  const out = {
    fit_mode: merged.fit_mode === 'manual' ? 'manual' : 'auto',
  };
  if (merged.ctx != null) out.ctx = merged.ctx;
  if (merged.cache_type) out.cache_type = merged.cache_type;
  if (merged.parallel != null) out.parallel = merged.parallel;
  if (merged.fit != null) out.fit = merged.fit;
  if (merged.n_gpu_layers != null && merged.n_gpu_layers !== LEGACY_OFFLOAD_ALL) {
    out.n_gpu_layers = merged.n_gpu_layers;
  }
  if (merged.no_mmap === true) out.no_mmap = true;
  if (merged.mlock === true) out.mlock = true;
  if (typeof merged.chat_template === 'string' && merged.chat_template.trim()) {
    out.chat_template = merged.chat_template.trim();
  }
  if (typeof merged.chat_template_file === 'string' && merged.chat_template_file.trim()) {
    out.chat_template_file = merged.chat_template_file.trim();
  }
  return out;
}

/**
 * Host threads when some layers stay on CPU. GPU auto leaves ngl unset so llama.cpp
 * owns the split — pinning `-t` there fights `--fit`.
 * @returns {number}
 */
function cpuThreadCount() {
  const n = os.availableParallelism?.() ?? os.cpus()?.length ?? 0;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * @param {object} opts
 * @param {string} variant
 * @param {number} parallel
 * @returns {LlamaLaunchPlan}
 */
function planOrPreferredFallback(opts, variant, parallel) {
  const hardware = opts.hardware && typeof opts.hardware === 'object' ? opts.hardware : {};
  const geometry = resolveLaunchGeometry(opts.modelMeta ?? {}, opts.ggufMeta ?? null);
  const weightsBytes = resolveWeightsBytes(opts);
  const trainCtx = resolveTrainCtx(opts.ggufMeta);
  const budget = launchBudgetBytes(hardware, variant);

  // Empty / unusable hardware yields a 0-byte budget (GPU variant with no VRAM figure
  // AND no RAM figures). Do not resurrect ngl=999. Prefer --fit on + the 32k rung so
  // llama.cpp still sizes the split; Minnow still passes a concrete -c.
  if (!(budget > 0)) {
    return {
      ctx: PREFERRED_CONTEXT_TOKENS,
      ctxPerSlot: PREFERRED_CONTEXT_TOKENS,
      n_gpu_layers: isCpuLlamaVariant(variant) ? 0 : null,
      cache_type: 'f16',
      flash_attn: flashAttnForVariant(variant),
      fits: false,
      estimateGb: 0,
      reason: 'Hardware snapshot missing; using preferred context with --fit on.',
      clampedFrom: null,
    };
  }

  return planLlamaLaunch({
    geometry,
    weightsBytes,
    trainCtx,
    hardware,
    variant,
    parallel,
  });
}

/**
 * Apply the auto plan: planner owns ctx / ngl / cache_type. Pass-through fields stay.
 * @param {LlamaServeSettings} merged
 * @param {LlamaLaunchPlan} plan
 */
function applyAutoPlan(merged, plan) {
  merged.ctx = plan.ctx;
  if (plan.n_gpu_layers == null) {
    delete merged.n_gpu_layers;
  } else {
    merged.n_gpu_layers = plan.n_gpu_layers;
  }
  merged.cache_type = plan.cache_type;
  // llama.cpp aborts --fit when -ngl is set. GPU auto leaves ngl unset → fit on.
  merged.fit = plan.n_gpu_layers == null;
  merged.fit_mode = 'auto';
}

/**
 * Manual: leave ctx / ngl / cache_type unclamped. Fit off when the user set ngl
 * (llama.cpp cannot fit AND honour -ngl). Fit on is OK when ngl is unset.
 * @param {LlamaServeSettings} merged
 */
function applyManualFit(merged) {
  merged.fit_mode = 'manual';
  if (merged.n_gpu_layers != null) {
    merged.fit = false;
  } else {
    merged.fit = true;
  }
}

/**
 * Advisory estimate of the *actual* manual launch vs the planner budget.
 * `plan.estimateGb` is the auto plan, not the user's 128k — measure what we will spawn.
 * @param {object} opts
 * @param {string} variant
 * @param {LlamaServeSettings} merged
 * @param {LlamaLaunchPlan} plan
 * @returns {string | null}
 */
function manualOverBudgetWarning(opts, variant, merged, plan) {
  const hardware = opts.hardware && typeof opts.hardware === 'object' ? opts.hardware : {};
  const budgetBytes = launchBudgetBytes(hardware, variant);
  if (!(budgetBytes > 0)) return null;

  const geometry = resolveLaunchGeometry(opts.modelMeta ?? {}, opts.ggufMeta ?? null);
  const weightsBytes = resolveWeightsBytes(opts);
  const estimate = estimateRunMemory({
    geometry,
    weightsBytes,
    ctx: Number(merged.ctx) > 0 ? Number(merged.ctx) : plan.ctx,
    cacheType: merged.cache_type || plan.cache_type,
    nGpuLayers: merged.n_gpu_layers == null ? undefined : merged.n_gpu_layers,
    backend: typeof hardware.backend === 'string' ? hardware.backend : undefined,
  });

  if (estimate.totalBytes <= budgetBytes * FIT_PLANNER_OVERBUDGET_RATIO) return null;

  return `warning: you overrode the fit planner; estimate ~${estimate.totalGb} GB vs ~${gbLabel(budgetBytes)} GB budget`;
}

/**
 * Build llama-server argv plus the plan / warning startServe logs and stores.
 * `buildLlamaServerArgs` remains the `string[]` wrapper for existing callers.
 *
 * @param {object} opts
 * @param {string} opts.modelPath
 * @param {number} opts.port
 * @param {string} [opts.profileKey]
 * @param {Record<string, unknown>} [opts.hardware]
 * @param {Record<string, unknown>} [opts.modelMeta]
 * @param {LlamaServeSettings} [opts.settings]
 * @param {LlamaServeSettings} [opts.defaults]
 * @param {LlamaVariant} [opts.variant]
 * @param {string} [opts.mmprojPath] Sibling vision projector (mmproj*.gguf).
 * @param {Record<string, unknown> | null} [opts.ggufMeta] Parsed GGUF header from readGgufMetadata.
 * @param {number} [opts.weightsBytes] On-disk weights size; else `modelMeta.serveWeightsGb`.
 * @param {string} [opts.libraryId] Stable `--alias` for `/v1/models` when startServe has a row id.
 * @returns {LlamaServerLaunch}
 */
export function buildLlamaServerLaunch(opts) {
  const {
    modelPath,
    port,
    profileKey = 'balanced',
    hardware,
    modelMeta = {},
    settings,
    defaults,
    variant = 'cpu',
    mmprojPath,
    ggufMeta,
    libraryId,
  } = opts;

  /** @type {LlamaServeSettings} */
  let profileSettings = {};

  if (hardware && typeof hardware === 'object') {
    // Exact header (nLayers, layerBytes, SWA, trainCtx) beats architecture /
    // parameter-count heuristics inside computeServeProfiles. Inspector preview
    // and startServe must pass the same ggufMeta so argv geometry matches.
    const profiles = computeServeProfiles(hardware, modelMeta, {
      serveWeightsGb: modelMeta.serveWeightsGb,
      serveQuant: modelMeta.serveQuant,
      ggufMeta: ggufMeta ?? null,
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

  // Default is auto even when a legacy payload still contains ctx:125000 / n_gpu_layers:999
  // (old inspector, onboarding profile ctx, llama-cpp.json defaults). `fit: true` is not
  // manual — onboarding must stay AUTO so the planner wins.
  const fitMode = merged.fit_mode === 'manual' ? 'manual' : 'auto';
  const parallel = Math.max(1, Math.trunc(Number(merged.parallel) || 1));
  const plan = planOrPreferredFallback(opts, variant, parallel);

  let warning = null;
  if (fitMode === 'manual') {
    // Profiles still emit ngl=999. That is not a user choice — drop it so
    // manual-without-ngl can keep --fit on (llama.cpp aborts fit when ngl is set).
    const userSetNgl = settings?.n_gpu_layers != null || defaults?.n_gpu_layers != null;
    if (!userSetNgl && merged.n_gpu_layers === LEGACY_OFFLOAD_ALL) {
      delete merged.n_gpu_layers;
    }
    applyManualFit(merged);
    warning = manualOverBudgetWarning(opts, variant, merged, plan);
  } else {
    applyAutoPlan(merged, plan);
  }

  const extraArgs = normalizeExtraArgs(merged.extra_args);
  /** True when extra_args already sets this flag (`--flag` or `--flag=value`). */
  const extraHasFlag = (flag) =>
    extraArgs.some((token) => token === flag || token.startsWith(`${flag}=`));
  // `--no-jinja` is a Minnow skip signal, not a llama-server flag — strip it so
  // a bad-template retry does not pass an unknown switch.
  const skipJinja = merged.skip_jinja === true || extraHasFlag('--no-jinja');
  const forwardedExtra = extraArgs.filter((token) => {
    if (token === '--no-jinja') return false;
    // A template retry must not re-add --jinja from user extra_args either.
    if (skipJinja && token === '--jinja') return false;
    return true;
  });

  const args = [
    '-m',
    modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ];

  // Stable /v1/models id matching the library row. Skip when extra_args already
  // set --alias so a user override wins without duplicating the flag.
  const aliasId = typeof libraryId === 'string' ? libraryId.trim() : '';
  if (aliasId && !extraHasFlag('--alias')) {
    args.push('--alias', aliasId);
  }

  // GGUF-embedded Jinja templates (Qwen3.8 thinking/tools) need --jinja on llama-server.
  // Phase 3 retries once without it when minja cannot parse the template.
  if (!skipJinja && !extraHasFlag('--jinja')) {
    args.push('--jinja');
  }

  // VLM projector living next to the weights — llama-server will not auto-discover it.
  if (mmprojPath && !extraHasFlag('--mmproj')) {
    args.push('--mmproj', mmprojPath);
  }

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

  // Always emit `--parallel` from the plan. Default is 1 unless settings.parallel
  // is set — do not silently bump GPU to 2 (that halves per-slot context).
  // `-c` is already ctxPerSlot * parallel from the planner.
  if (!extraHasFlag('--parallel')) {
    args.push('--parallel', String(parallel));
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
    // --fit-ctx is the floor auto-fit may choose (CONTEXT_LADDER min). --fit-target is
    // MiB per device (confirmed via local llama-server --help). Do not pass --swa-full:
    // sliding-window savings already live in kvCacheBytes().
    if (!extraHasFlag('--fit-ctx')) {
      args.push('--fit-ctx', String(CONTEXT_LADDER[0]));
    }
    if (!extraHasFlag('--fit-target')) {
      args.push('--fit-target', String(fitTargetMib(hardware, variant)));
    }
  } else if (merged.fit === false) {
    args.push('--fit', 'off');
  }

  if (!extraHasFlag('--flash-attn')) {
    args.push('--flash-attn', plan.flash_attn);
  }

  if (merged.no_warmup === true) {
    args.push('--no-warmup');
  }

  // Continuous batching is how LM Studio overlaps prompts; extra_args can
  // disable it with --no-cont-batching or set it explicitly.
  if (!extraHasFlag('--cont-batching') && !extraHasFlag('--no-cont-batching')) {
    args.push('--cont-batching');
  }

  // Prompt-cache reuse (tokens) — 256 matches LM Studio's default. Skip when
  // extra_args already picked a value (`--cache-reuse` or `--cache-reuse=N`).
  if (!extraHasFlag('--cache-reuse')) {
    args.push('--cache-reuse', '256');
  }

  // Threads only when some layers stay on CPU. GPU auto leaves ngl unset so
  // llama.cpp --fit sizes the split — do not pin `-t` there. CPU auto is
  // `-ngl 0`; with a known nLayers that is a partial offload and needs threads.
  const nLayers = Number(ggufMeta?.nLayers);
  const ngl = merged.n_gpu_layers;
  const threadsKnownPartialOffload =
    ngl != null && Number.isFinite(nLayers) && nLayers > 0 && ngl < nLayers;
  if (
    threadsKnownPartialOffload &&
    !extraHasFlag('-t') &&
    !extraHasFlag('--threads')
  ) {
    const threads = cpuThreadCount();
    if (threads > 0) args.push('-t', String(threads));
  }

  // mmap/mlock default off. mmap_failed suggested retry still uses extra_args
  // `--no-mmap`; honor that path and the boolean settings without duplicating.
  if (merged.no_mmap === true && !extraHasFlag('--no-mmap')) {
    args.push('--no-mmap');
  }
  if (merged.mlock === true && !extraHasFlag('--mlock')) {
    args.push('--mlock');
  }

  // First-class chat template so quoted values survive extra_args tokenization.
  const chatTemplate =
    typeof merged.chat_template === 'string' ? merged.chat_template.trim() : '';
  if (chatTemplate && !extraHasFlag('--chat-template')) {
    args.push('--chat-template', chatTemplate);
  }
  const chatTemplateFile =
    typeof merged.chat_template_file === 'string' ? merged.chat_template_file.trim() : '';
  if (chatTemplateFile && !extraHasFlag('--chat-template-file')) {
    args.push('--chat-template-file', chatTemplateFile);
  }

  // Do NOT pass `--reasoning-budget` here — it overrides and disables per-request
  // `thinking_budget_tokens` on the OpenAI-compatible API (llama.cpp PR #20297).

  for (const token of forwardedExtra) {
    if (typeof token === 'string' && token.trim()) {
      args.push(token.trim());
    }
  }

  return {
    args,
    plan,
    warning,
    settings: effectiveLlamaSettings(merged),
  };
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
 * @param {string} [opts.mmprojPath] Sibling vision projector (mmproj*.gguf).
 * @param {Record<string, unknown> | null} [opts.ggufMeta] Parsed GGUF header from readGgufMetadata.
 * @param {number} [opts.weightsBytes]
 * @param {string} [opts.libraryId]
 * @returns {string[]}
 */
export function buildLlamaServerArgs(opts) {
  return buildLlamaServerLaunch(opts).args;
}

/**
 * Warn when user extra_args include --reasoning-budget (disables per-request budgets).
 * @param {LlamaServeSettings | null | undefined} settings
 * @param {LlamaServeSettings | null | undefined} defaults
 */
export function warnIfReasoningBudgetCliFlag(settings, defaults) {
  const extras = [
    ...normalizeExtraArgs(defaults?.extra_args),
    ...normalizeExtraArgs(settings?.extra_args),
  ];
  if (extras.some((token) => typeof token === 'string' && /--reasoning-budget\b/.test(token))) {
    console.warn(
      '[llama-cpp] --reasoning-budget in serve extra_args disables per-request thinking_budget_tokens',
    );
  }
}

/**
 * Find a sibling mmproj*.gguf next to the weight file (vision projector).
 * Prefers mmproj-F16 when several projectors exist in the same directory.
 * @param {string} modelPath
 * @returns {Promise<string | null>}
 */
export async function findSiblingMmproj(modelPath) {
  if (!modelPath || typeof modelPath !== 'string') return null;
  const dir = path.dirname(modelPath);
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const hits = names.filter((name) => {
    const n = name.toLowerCase();
    return n.endsWith('.gguf') && n.includes('mmproj');
  });
  if (!hits.length) return null;
  const preferred = hits.find((name) => /mmproj-f16\.gguf$/i.test(name));
  return path.join(dir, preferred ?? hits.sort((a, b) => a.localeCompare(b))[0]);
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
