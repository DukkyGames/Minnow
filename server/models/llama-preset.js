/**
 * Generate llama-server router preset INI from installed artifacts and user config.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { detectHardware } from '../system/hardware.js';
import { readLlamaCppConfig } from './llama-args.js';
import { scanInstalledArtifacts } from './installed.js';
import { computeServeProfiles } from './profiles.js';
import { isGpuCapableVariant } from './llama-variant.js';
import { getInstalledLlamaVariant } from './llama-runtime.js';
import { getLlamaPresetIniPath } from './paths.js';

/**
 * Map Minnow llama settings keys to llama-server INI keys.
 * @param {import('./llama-args.js').LlamaServeSettings} settings
 * @returns {Record<string, string | number>}
 */
function settingsToIniKeys(settings) {
  /** @type {Record<string, string | number>} */
  const out = {};
  if (!settings || typeof settings !== 'object') return out;

  if (settings.ctx != null) out['ctx-size'] = settings.ctx;
  if (settings.n_gpu_layers != null) out['n-gpu-layers'] = settings.n_gpu_layers;
  if (settings.cache_type && settings.cache_type !== 'f16') {
    out['cache-type-k'] = settings.cache_type;
    out['cache-type-v'] = settings.cache_type;
  }
  if (settings.n_cpu_moe != null && settings.n_cpu_moe > 0) {
    out['n-cpu-moe'] = settings.n_cpu_moe;
  }
  if (settings.batch_size != null) out['batch-size'] = settings.batch_size;
  if (settings.ubatch_size != null) out['ubatch-size'] = settings.ubatch_size;
  if (settings.parallel != null) out['parallel'] = settings.parallel;
  if (settings.split_mode) out['split-mode'] = settings.split_mode;
  if (settings.tensor_split) out['tensor-split'] = settings.tensor_split;
  if (settings.main_gpu != null) out['main-gpu'] = settings.main_gpu;
  if (settings.fit === true) out.fit = 'on';
  if (settings.no_warmup === true) out['no-warmup'] = 'on';

  return out;
}

/**
 * Serialize one INI section.
 * @param {string} name
 * @param {Record<string, string | number>} entries
 */
function formatIniSection(name, entries) {
  const lines = [`[${name}]`];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${key} = ${value}`);
  }
  return lines.join('\n');
}

/**
 * Section name for a GGUF file — router matches basename without extension.
 * @param {string} filename
 */
export function presetSectionNameFromFilename(filename) {
  return filename.replace(/\.gguf$/i, '');
}

/**
 * Balanced profile defaults when no per-model override exists.
 * @param {Record<string, unknown>} hardware
 * @param {import('./installed.js').InstalledArtifact} artifact
 */
function defaultProfileSettings(hardware, artifact) {
  const modelMeta = {
    name: artifact.filename,
    quantization: inferQuantFromFilename(artifact.filename),
  };
  const profiles = computeServeProfiles(hardware, modelMeta, {});
  const balanced = profiles.find((p) => p.key === 'balanced') || profiles[1] || profiles[0];
  if (!balanced) return {};
  return {
    ctx: balanced.ctx,
    n_gpu_layers: balanced.n_gpu_layers,
    cache_type: balanced.cache_type,
    n_cpu_moe: balanced.n_cpu_moe,
  };
}

/**
 * Best-effort quant label from a GGUF filename (e.g. Q4_K_M).
 * @param {string} filename
 */
function inferQuantFromFilename(filename) {
  const m = filename.match(/(Q\d+[_A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : 'Q4_K_M';
}

/**
 * Apply GPU variant rules to global/per-model n-gpu-layers.
 * @param {import('./llama-args.js').LlamaServeSettings} settings
 * @param {string | null} variant
 */
function applyVariantGpuRules(settings, variant) {
  if (!isGpuCapableVariant(variant ?? 'cpu')) {
    settings.n_gpu_layers = 0;
  } else if (settings.n_gpu_layers === undefined || settings.n_gpu_layers === null) {
    settings.n_gpu_layers = 999;
  }
  return settings;
}

/**
 * Write ~/.minnow/models/llama-preset.ini from config + installed artifacts.
 * @returns {Promise<string>} absolute path to the preset file
 */
export async function writeLlamaPresetIni() {
  const config = await readLlamaCppConfig();
  const defaults =
    config.defaults && typeof config.defaults === 'object' ? config.defaults : {};
  const perModel =
    config.perModel && typeof config.perModel === 'object' ? config.perModel : {};
  const variant =
    (typeof config.variant === 'string' ? config.variant : null) ??
    (await getInstalledLlamaVariant()) ??
    'cpu';
  const hardware = await detectHardware();

  const globalSettings = applyVariantGpuRules({ ...defaults }, variant);
  const globalIni = settingsToIniKeys(globalSettings);

  const artifacts = await scanInstalledArtifacts();
  const sections = [];

  if (Object.keys(globalIni).length > 0) {
    sections.push(formatIniSection('*', globalIni));
  }

  for (const artifact of artifacts) {
    const sectionName = presetSectionNameFromFilename(artifact.filename);
    const override =
      perModel[sectionName] && typeof perModel[sectionName] === 'object'
        ? perModel[sectionName]
        : defaultProfileSettings(hardware, artifact);

    const merged = applyVariantGpuRules(
      {
        ...override,
      },
      variant,
    );
    const modelIni = {
      model: path.resolve(artifact.path),
      ...settingsToIniKeys(merged),
    };
    sections.push(formatIniSection(sectionName, modelIni));
  }

  const content = `${sections.join('\n\n')}\n`;
  const presetPath = getLlamaPresetIniPath();
  await fsp.mkdir(path.dirname(presetPath), { recursive: true });
  await fsp.writeFile(presetPath, content, 'utf8');
  return presetPath;
}
