/**
 * Load progress for a starting local serve (llama.cpp or mlx-lm).
 *
 * llama-server does not print `progress = N %` during a weight load. What it does
 * print (b9628, `-lv 4`, Qwen3.8-27B IQ4_XS on RTX 4090) is a sequence of checkpoints
 * and then a row of dots (one `.` per integer percent of tensor copy):
 *
 *   0.19s  llama_server: loading model
 *   0.24s  llama_model_loader: loaded meta data
 *   0.64s  load_tensors: loading model tensors     ← last line before the long copy
 *   1.73s  load_tensors: offloaded 66/66 layers    ← often buffered with the dots
 *   1.73–5.92s  `......... ` (93 dots)             ← the actual GPU upload
 *   5.92s  llama_context: constructing
 *   6.06s  warming up the model
 *   6.13s  creating MTP draft context              ← Qwen3.8 speculative
 *   6.16s  clip_model_loader                       ← mmproj
 *   6.96s  loaded multimodal model / initializing slots
 *   7.05s  speculative decoding context initialized
 *   7.09s  model loaded / server is listening
 *
 * `/health` answers in the same breath as "listening", so those late lines often
 * never paint. The weights band is therefore wide (16–82): it is the last checkpoint
 * that is reliably on disk during the silent copy. Dots, when they flush, map onto
 * that same band. 100 is only ever claimed on a healthy probe (`/health` for
 * llama.cpp, warmup POST for mlx-lm).
 *
 * mlx-lm has no llama log phases. An unmatched / empty log plus `runtime: 'mlx-lm'`
 * uses a single "Loading weights" band (0–97). Same time+size model, same 100 gate.
 *
 * Pure and I/O-free so the arithmetic is testable without spawning a server.
 */

/**
 * Phases in the order llama-server reaches them. `pattern` is what the log prints on
 * entry; the last phase whose pattern has appeared wins, so an out-of-order match on an
 * earlier line cannot drag the bar backwards.
 *
 * Floors are wall-time shares from the b9628 capture above (7.09s = 100), not guesses
 * about which step "feels" expensive. `fitting params` is absent on that run (fit
 * already chose ngl) but still a checkpoint when it does print.
 *
 * @type {ReadonlyArray<{ key: string, label: string, floor: number, ceiling: number, pattern: RegExp | null }>}
 */
export const LOAD_PHASES = [
  {
    key: 'spawning',
    label: 'Starting runtime',
    floor: 0,
    ceiling: 3,
    pattern: null,
  },
  {
    key: 'loading',
    label: 'Opening the model file',
    floor: 3,
    ceiling: 8,
    pattern: /llama_server:\s*loading model|load_model:\s*loading model/i,
  },
  {
    key: 'fitting',
    label: 'Fitting to device memory',
    floor: 8,
    ceiling: 12,
    pattern: /fitting params to device memory/i,
  },
  {
    key: 'header',
    label: 'Reading model header',
    floor: 12,
    ceiling: 16,
    pattern: /llama_model_loader:\s*loaded meta data/i,
  },
  {
    // Wide on purpose: the CUDA copy lives here, and `offloaded N/N` often lands
    // in the same stdout flush as the dots + context, too late to own 70%.
    key: 'weights',
    label: 'Loading weights',
    floor: 16,
    ceiling: 82,
    pattern:
      /loading model tensors|load_tensors:\s*loading|load_tensors:\s*offloaded\s+\d+\/\d+\s+layers|model buffer size\s*=/i,
  },
  {
    key: 'context',
    label: 'Allocating context',
    floor: 82,
    ceiling: 88,
    pattern: /llama_context:\s*constructing|llama_kv_cache:\s*size\s*=|sched_reserve:|KV self size/i,
  },
  {
    key: 'warmup',
    label: 'Warming up',
    floor: 88,
    ceiling: 96,
    pattern:
      /warming up the model|initializing slots|creating MTP draft context|clip_model_loader:|loaded multimodal model|speculative decoding context initialized/i,
  },
  {
    key: 'listening',
    label: 'Starting the server',
    floor: 96,
    ceiling: 100,
    pattern: /server is listening|llama_server:\s*model loaded|starting the main loop/i,
  },
];

/**
 * Single band for mlx-lm. mlx-lm.log is not llama-server; scraping GGUF phase
 * regexes would leave the label on "Starting runtime" for the whole warmup.
 */
export const MLX_LOAD_PHASE = {
  key: 'mlx-weights',
  label: 'Loading weights',
  floor: 0,
  ceiling: 97,
  pattern: null,
};

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

/** Ceiling until the serve is actually ready. 100 is only ever claimed on a real probe. */
export const MAX_PERCENT_BEFORE_HEALTHY = 99;

/**
 * First-load bytes/ms when we have a file size but no measured prior.
 *
 * Qwen3.8-27B IQ4_XS (13.26 GiB) on RTX 4090 + NVMe finished in 7.09s ≈ 1.9 GiB/s.
 * 1.5 GiB/s is a shade slower so a first CUDA load of that file sits around 80%
 * when `/health` answers, not 40% of a flat 25s clock. CPU/HDD loads overshoot
 * to 99 and wait — better than jumping from 40 to Ready.
 */
const FIRST_LOAD_BYTES_PER_MS = 1.5 * 1024 * 1024;

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
 * @param {string | null | undefined} [runtime] `mlx-lm` skips llama log regexes.
 * @returns {{ key: string, label: string, floor: number, ceiling: number }}
 */
export function matchLoadPhase(text, runtime) {
  if (runtime === 'mlx-lm') {
    return {
      key: MLX_LOAD_PHASE.key,
      label: MLX_LOAD_PHASE.label,
      floor: MLX_LOAD_PHASE.floor,
      ceiling: MLX_LOAD_PHASE.ceiling,
    };
  }
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

/**
 * llama.cpp prints one `.` per integer percent of tensor copy (`LLAMA_LOG_CONT`).
 * Timestamps use single dots (`0.01.726.375`); a run of 10+ is the progress bar.
 * Null when the copy has not started flushing yet.
 *
 * @param {string | null | undefined} text
 * @returns {number | null} 10–100
 */
export function parseWeightLoadDots(text) {
  if (!text) return null;
  let best = 0;
  for (const match of String(text).matchAll(/\.{10,}/g)) {
    if (match[0].length > best) best = match[0].length;
  }
  if (best < 10) return null;
  return Math.min(100, best);
}

/** Map a 0–100 tensor-copy reading onto the weights phase band. */
function percentFromWeightDots(dots) {
  const weights = LOAD_PHASES.find((phase) => phase.key === 'weights');
  if (!weights || !(dots > 0)) return 0;
  return weights.floor + (weights.ceiling - weights.floor) * (Math.min(100, dots) / 100);
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
 * @property {number | null} [lastElapsedMs] Elapsed ms on the previous tick, so skipped-phase catch-up can be rate-limited.
 * @property {number | null} [reportedPercent] A real percentage from the runtime, if a
 *   future build ever prints one. Always wins over the model. Null/undefined means
 *   none — `Number(null)` is 0 and must not be treated as a reported value.
 * @property {boolean} [healthy] Serve is ready — `/health` for llama.cpp, warmup
 *   POST for mlx-lm. The only way to reach 100.
 * @property {string} [runtime] `mlx-lm` uses a single Loading-weights band.
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
 * Typical wall time for a first load with no rate prior. Paces the climb and
 * the overtime leak past a silent phase ceiling. Not shown as an ETA.
 */
const DEFAULT_LOAD_MS = 25_000;

/**
 * When the log skips a phase (fitting 4% then offload at 70%), ease toward the
 * new floor over this window instead of snapping.
 */
const PHASE_CATCHUP_MS = 600;

/** Worst skip we smooth (fitting floor → context floor). */
const PHASE_CATCHUP_SPAN = 82;

/**
 * Modelled percent for the current log phase.
 *
 * Three clocks, one number:
 * - Clock behind the log (small GGUF already at KV-cache): climb from the
 *   floor across the band so we do not sit on 78% until 19s.
 * - Clock inside the band: use elapsed/typical directly.
 * - Clock ahead of the log (silent tensor load after "fitting params"): leak
 *   past the ceiling toward 99. Hard-capping at the ceiling is why Local
 *   Server sat on 4% for most of a load, then jumped to Ready.
 *
 * A stale fast prior must not race to 99 while we are still fitting, so the
 * overtime leak is paced over at least DEFAULT_LOAD_MS, not the prior alone.
 *
 * @param {{ floor: number, ceiling: number }} phase
 * @param {number} elapsedMs
 * @param {number} typicalTotalMs Rate-prior duration, or DEFAULT_LOAD_MS.
 */
function modelledPercentForPhase(phase, elapsedMs, typicalTotalMs) {
  const totalMs = typicalTotalMs > 0 ? typicalTotalMs : DEFAULT_LOAD_MS;
  const timePercent = totalMs > 0 ? (Math.max(0, elapsedMs) / totalMs) * 100 : 0;

  if (timePercent < phase.floor) {
    const t = totalMs > 0 ? Math.min(0.999, Math.max(0, elapsedMs) / totalMs) : 0;
    return phase.floor + (phase.ceiling - phase.floor) * t;
  }

  if (timePercent <= phase.ceiling) return timePercent;

  const typicalMsForCeiling = (phase.ceiling / 100) * totalMs;
  const overtimeMs = Math.max(0, elapsedMs - typicalMsForCeiling);
  const leakSpan = Math.max(totalMs, DEFAULT_LOAD_MS);
  // Listening's ceiling is 100; remaining must not go negative or a long
  // wait on "server is listening" walks the bar backwards from 99.
  const remaining = Math.max(0, MAX_PERCENT_BEFORE_HEALTHY - phase.ceiling);
  const leak = leakSpan > 0 ? (overtimeMs / leakSpan) * remaining : 0;
  return Math.min(MAX_PERCENT_BEFORE_HEALTHY, phase.ceiling + leak);
}

/**
 * Cap a jump toward a later phase floor so skipped log markers do not snap.
 * @param {number} previous
 * @param {number} target
 * @param {number} dtMs
 */
function easeToward(previous, target, dtMs) {
  const span = target - previous;
  if (span <= 0) return target;
  if (!(dtMs > 0)) return previous;
  const maxRise = (PHASE_CATCHUP_SPAN / PHASE_CATCHUP_MS) * dtMs;
  return previous + Math.min(span, maxRise);
}

/**
 * One tick of the bar.
 * @param {LoadProgressInput} input
 * @returns {LoadProgressResult}
 */
export function computeLoadProgress(input) {
  const phase = matchLoadPhase(input.logText, input.runtime);
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
  const lastElapsedMs = Number(input.lastElapsedMs);
  // First tick has no prior sample: treat elapsed as the delta so a late first
  // paint (tab was in the background) can catch up instead of sitting at 0.
  const dtMs = Number.isFinite(lastElapsedMs) ? Math.max(0, elapsedMs - lastElapsedMs) : elapsedMs;
  const weightsBytes = positive(input.weightsBytes);
  const bytesPerMs =
    positive(input.bytesPerMs) || (weightsBytes > 0 ? FIRST_LOAD_BYTES_PER_MS : 0);
  const predictedTotalMs = weightsBytes > 0 && bytesPerMs > 0 ? weightsBytes / bytesPerMs : 0;

  // Rate prior when we have one, else file size at FIRST_LOAD_BYTES_PER_MS, else
  // the 25s clock. The phase floor still holds us up; the weights band is wide
  // enough that a 7s CUDA copy of a 13 GiB file does not finish painted at 40%.
  const typicalTotalMs = predictedTotalMs > 0 ? predictedTotalMs : DEFAULT_LOAD_MS;
  let modelledPercent = modelledPercentForPhase(phase, elapsedMs, typicalTotalMs);
  const dots = parseWeightLoadDots(input.logText);
  if (dots != null) modelledPercent = Math.max(modelledPercent, percentFromWeightDots(dots));
  const target = capped(Math.max(modelledPercent, floorFromPrevious));
  const percent = capped(easeToward(floorFromPrevious, target, dtMs));

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
 * Compact percent for chips and chat (`37%`). Empty until the model has left 0
 * so the first paint is not a stuck "Loading 0%".
 * @param {unknown} percent
 * @returns {string}
 */
export function formatLoadPercentLabel(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.round(n)}%`;
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
