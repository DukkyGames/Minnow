/**
 * Load progress for a starting llama.cpp serve.
 *
 * llama-server never prints a weight-load percentage. Verified against b9628: at the
 * default verbosity the entire load is silent — an 11-second gap with no output — and
 * even at `-lv 4` the loader prints phase lines and a row of dots, never a number. So
 * the bar is *modelled*, not scraped:
 *
 * - the log pins which phase we are in, and each phase owns a floor and a ceiling;
 * - inside that band, an elapsed-time / bytes-per-ms model does the moving;
 * - the caller holds the result monotonic and only ever reaches 100 on a healthy probe.
 *
 * Pure and I/O-free so the arithmetic is testable without spawning a server.
 */

/**
 * Phases in the order llama-server reaches them. `pattern` is what the log prints on
 * entry; the last phase whose pattern has appeared wins, so an out-of-order match on an
 * earlier line cannot drag the bar backwards.
 *
 * Markers are the ones actually observed on b9628. Several print at the default
 * verbosity; the rest need `-lv 4`, which `buildLlamaServerLaunch` now passes. A run
 * that only lights up half of them still advances — it just has fewer waypoints.
 *
 * @type {ReadonlyArray<{ key: string, label: string, floor: number, ceiling: number, pattern: RegExp | null }>}
 */
export const LOAD_PHASES = [
  {
    key: 'spawning',
    label: 'Starting runtime',
    floor: 0,
    ceiling: 4,
    pattern: null,
  },
  {
    key: 'fitting',
    label: 'Fitting to device memory',
    floor: 4,
    ceiling: 12,
    pattern: /fitting params to device memory/i,
  },
  {
    key: 'header',
    label: 'Reading model header',
    floor: 12,
    ceiling: 18,
    pattern: /llama_model_loader:\s*loaded meta data/i,
  },
  {
    key: 'weights',
    label: 'Loading weights',
    floor: 18,
    ceiling: 70,
    pattern: /loading model tensors|load_tensors:\s*loading/i,
  },
  {
    key: 'offload',
    label: 'Placing layers',
    floor: 70,
    ceiling: 78,
    pattern: /load_tensors:\s*offloaded\s+\d+\/\d+\s+layers|model buffer size\s*=/i,
  },
  {
    key: 'context',
    label: 'Allocating context',
    floor: 78,
    ceiling: 88,
    pattern: /llama_context:\s*constructing|llama_kv_cache:\s*size\s*=|sched_reserve:|KV self size/i,
  },
  {
    key: 'warmup',
    label: 'Warming up',
    floor: 88,
    ceiling: 97,
    pattern: /warming up the model|initializing slots/i,
  },
  {
    key: 'listening',
    label: 'Starting the server',
    floor: 97,
    ceiling: 100,
    pattern: /server is listening|llama_server:\s*model loaded|starting the main loop/i,
  },
];

/**
 * `srv load_model: [spec] estimated memory usage of MTP context is 168.02 MiB`.
 * `.` excludes newlines in JS, so no character class is needed.
 */
const SPEC_CONTEXT_BYTES_PATTERN =
  /\[spec\].*?memory usage of .*?context is\s+([\d.]+)\s*(MiB|GiB|KiB|B)/i;

/**
 * Bytes llama-server reserved for a speculative-decoding context, from its own report.
 *
 * MTP needs no second weights file, but its context is not free, and this line is the
 * only place the real figure exists — nothing in the GGUF header predicts it. Null when
 * the line has not been printed (no spec decoding, or the load has not reached it).
 *
 * @param {string | null | undefined} text
 * @returns {number | null}
 */
export function parseSpecContextBytes(text) {
  if (!text) return null;
  const match = SPEC_CONTEXT_BYTES_PATTERN.exec(String(text));
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = match[2].toLowerCase();
  const scale = unit === 'gib' ? 1024 ** 3 : unit === 'mib' ? 1024 ** 2 : unit === 'kib' ? 1024 : 1;
  return Math.round(value * scale);
}

/** Ceiling until `/health` answers. 100 is only ever claimed on a real probe. */
export const MAX_PERCENT_BEFORE_HEALTHY = 99;

/**
 * Weight of the newest sample in the rolling per-variant load rate. Low enough that one
 * cold-cache load does not poison the prior, high enough to follow a disk swap.
 */
const RATE_EWMA_ALPHA = 0.3;

/** Rates outside this band are a measurement artifact, not a disk. Bytes per ms. */
const MIN_BYTES_PER_MS = 1_000;
const MAX_BYTES_PER_MS = 20_000_000;

/**
 * The furthest phase the log has reached.
 * @param {string | null | undefined} text
 * @returns {{ key: string, label: string, floor: number, ceiling: number }}
 */
export function matchLoadPhase(text) {
  const haystack = String(text ?? '');
  let matched = LOAD_PHASES[0];
  if (haystack) {
    for (const phase of LOAD_PHASES) {
      if (phase.pattern && phase.pattern.test(haystack)) matched = phase;
    }
  }
  return {
    key: matched.key,
    label: matched.label,
    floor: matched.floor,
    ceiling: matched.ceiling,
  };
}

/** @param {unknown} value */
function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Bytes per millisecond to predict this load with.
 *
 * A prior measured on this exact model wins — same file, same disk, same offload split.
 * The rolling per-variant figure from `~/.minnow/llama-cpp.json` is the fallback so a
 * first-ever load still gets an ETA. CUDA and CPU builds differ by an order of
 * magnitude, which is why that figure is keyed by variant rather than shared.
 *
 * @param {{ lastLoadMs?: unknown, lastWeightsBytes?: unknown, variantBytesPerMs?: unknown }} priors
 * @returns {number} 0 when nothing usable is known
 */
export function resolveBytesPerMs(priors) {
  const lastLoadMs = positive(priors?.lastLoadMs);
  const lastWeightsBytes = positive(priors?.lastWeightsBytes);
  if (lastLoadMs > 0 && lastWeightsBytes > 0) {
    return clampRate(lastWeightsBytes / lastLoadMs);
  }
  const variantRate = positive(priors?.variantBytesPerMs);
  return variantRate > 0 ? clampRate(variantRate) : 0;
}

/** @param {number} rate */
function clampRate(rate) {
  if (!(rate > 0)) return 0;
  return Math.min(MAX_BYTES_PER_MS, Math.max(MIN_BYTES_PER_MS, rate));
}

/**
 * Fold one completed load into the rolling per-variant rate.
 * Returns the previous value unchanged when the sample is unusable, so a cancelled or
 * instant load cannot wipe a good prior.
 *
 * @param {unknown} previousBytesPerMs
 * @param {{ loadMs?: unknown, weightsBytes?: unknown }} sample
 * @returns {number} 0 when there is still nothing to record
 */
export function updateLoadRate(previousBytesPerMs, sample) {
  const loadMs = positive(sample?.loadMs);
  const weightsBytes = positive(sample?.weightsBytes);
  const previous = positive(previousBytesPerMs);
  if (!(loadMs > 0) || !(weightsBytes > 0)) return previous;
  const observed = clampRate(weightsBytes / loadMs);
  if (!(previous > 0)) return observed;
  return clampRate(previous * (1 - RATE_EWMA_ALPHA) + observed * RATE_EWMA_ALPHA);
}

/**
 * @typedef {object} LoadProgressInput
 * @property {string} [logText] Everything the serve has printed so far.
 * @property {number} elapsedMs Wall time since the process was spawned.
 * @property {number} [weightsBytes] Size of the weights being loaded.
 * @property {number} [bytesPerMs] From `resolveBytesPerMs`; 0 disables the time model.
 * @property {number | null} [previousPercent] Last value shown, to hold the bar monotonic.
 * @property {number | null} [reportedPercent] A real percentage from the runtime, if a
 *   future build ever prints one. Always wins over the model. Null/undefined means
 *   none — `Number(null)` is 0 and must not be treated as a reported value.
 * @property {boolean} [healthy] `/health` has answered — the only way to reach 100.
 */

/**
 * @typedef {object} LoadProgressResult
 * @property {number} percent 0–100, monotonic against `previousPercent`.
 * @property {string} phaseKey
 * @property {string} label
 * @property {number | null} etaMs Remaining time, or null when there is no usable model.
 * @property {boolean} modelled False when the number came from the runtime itself.
 */

/**
 * One tick of the bar.
 * @param {LoadProgressInput} input
 * @returns {LoadProgressResult}
 */
export function computeLoadProgress(input) {
  const phase = matchLoadPhase(input.logText);
  const previous = Number(input.previousPercent);
  const floorFromPrevious = Number.isFinite(previous) && previous > 0 ? previous : 0;

  if (input.healthy) {
    return { percent: 100, phaseKey: 'ready', label: 'Ready', etaMs: 0, modelled: false };
  }

  // `Number(null) === 0`. The store passes `parseLoadProgress(...)`, which is
  // null on every llama.cpp build we ship (none of them print a %). Treating
  // that as a reported 0% pins Local Server at "Loading 0%" for the whole load.
  const reported = reportedPercentOf(input.reportedPercent);
  if (reported != null) {
    return {
      percent: capped(Math.max(reported, floorFromPrevious)),
      phaseKey: phase.key,
      label: phase.label,
      etaMs: null,
      modelled: false,
    };
  }

  const elapsedMs = Math.max(0, Number(input.elapsedMs) || 0);
  const weightsBytes = positive(input.weightsBytes);
  const bytesPerMs = positive(input.bytesPerMs);
  const predictedTotalMs = weightsBytes > 0 && bytesPerMs > 0 ? weightsBytes / bytesPerMs : 0;

  // Without a rate prior the phase floor is the whole story: the bar steps between
  // waypoints instead of sweeping, which is honest rather than a fabricated crawl.
  const modelledPercent =
    predictedTotalMs > 0 ? (elapsedMs / predictedTotalMs) * 100 : phase.floor;

  const banded = Math.min(phase.ceiling, Math.max(phase.floor, modelledPercent));
  const percent = capped(Math.max(banded, floorFromPrevious));

  return {
    percent,
    phaseKey: phase.key,
    label: phase.label,
    // Once the model has overshot it is no longer predicting anything; say nothing
    // rather than sit at "0s left" while the disk keeps grinding.
    etaMs:
      predictedTotalMs > elapsedMs ? Math.round(predictedTotalMs - elapsedMs) : null,
    modelled: true,
  };
}

/**
 * A percentage the runtime itself printed. Null/undefined means "none", which is
 * the normal case — do not coerce that to 0.
 * @param {unknown} value
 * @returns {number | null}
 */
function reportedPercentOf(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** @param {number} percent */
function capped(percent) {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  return Math.min(MAX_PERCENT_BEFORE_HEALTHY, percent);
}
