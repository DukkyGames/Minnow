/**
 * Pure llama-server failure classifier. No I/O — logs and exit codes in, a
 * title / cause / remediation out. `classifyServeExit` wraps this so Phase 2
 * restart policy still keys off `oom_vram` / `port_conflict` / `unknown`.
 *
 * Signatures below are harvested from real llama.cpp / ggml stderr (b104xx).
 * Matching is first-hit in the order listed in `FAILURE_RULES`: more specific
 * GPU OOM strings before generic alloc failures, corrupt GGUF before mmap.
 */

import {
  planLlamaLaunch,
  snapContextToLadder,
} from '../../src/models/launch-plan.mjs';
import { specNeedsDraftModel } from '../../src/models/spec-decode.mjs';

/** Windows `STATUS_STACK_BUFFER_OVERRUN` / abort — llama.cpp hits this on RAM OOM. */
const WIN_FASTFAIL = 0xc0000409;
/** Windows `STATUS_DLL_NOT_FOUND` — missing cudart / VC runtime. */
const WIN_DLL_NOT_FOUND = 0xc0000135;
/** Windows `ERROR_EXE_MACHINE_TYPE_MISMATCH` — ARM64 llama-server on AMD64 (or the reverse). */
const WIN_EXE_MACHINE_MISMATCH = 216;
/** Windows `ERROR_BAD_EXE_FORMAT`. */
const WIN_BAD_EXE_FORMAT = 193;
/** Unix SIGKILL (128 + 9). Node reports 137; some platforms report a null code — we only trust 137. */
const UNIX_SIGKILL = 137;

/** Cut applied when re-planning after VRAM OOM so the retry is not the same budget. */
const OOM_VRAM_BUDGET_SCALE = 0.85;

/**
 * @typedef {object} DiagnosePlan
 * @property {number} [ctx]
 * @property {number} [ctxPerSlot]
 * @property {string} [cache_type]
 * @property {number | null} [n_gpu_layers]
 * @property {object} [geometry]
 * @property {number} [weightsBytes]
 * @property {object} [hardware]
 * @property {string} [variant]
 * @property {number} [trainCtx]
 * @property {number} [parallel]
 * @property {number} [splitCount]
 * @property {string} [spec_type] `--spec-type` the launch asked for.
 * @property {string} [spec_draft_model] `--spec-draft-model` path, when one was set.
 */

/**
 * @typedef {object} LlamaFailureDiagnosis
 * @property {string} code
 * @property {string} title
 * @property {string} detail
 * @property {string} remediation
 * @property {boolean} retryable
 * @property {Record<string, unknown>} [suggestedSettings]
 * @property {string[]} [chatTemplateFields] First-class chat_template keys (no invented template).
 */

/**
 * Pull a short, user-facing snippet from llama-server stderr/stdout.
 * Same 280-char grepped excerpt Phase 2 used as the entire error string.
 * @param {string | null | undefined} tail
 */
export function summarizeLlamaLogTail(tail) {
  if (!tail) return '';
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines
    .filter((line) => /error|fatal|usage:/i.test(line))
    .slice(-3);
  const excerpt = (interesting.length ? interesting : lines.slice(-2)).join(' ');
  return excerpt.slice(0, 280);
}

/**
 * Node on Windows may surface NTSTATUS as a signed int32. Compare as unsigned.
 * @param {unknown} exitCode
 * @returns {number | null}
 */
function unsignedExit(exitCode) {
  if (exitCode == null || exitCode === '') return null;
  const n = Number(exitCode);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? n >>> 0 : n;
}

/**
 * @param {string} haystack
 * @param {RegExp} pattern
 */
function has(haystack, pattern) {
  return pattern.test(haystack);
}

/**
 * Scale VRAM/RAM figures so `planLlamaLaunch` sees a 15% tighter budget.
 * We cannot pass a raw byte budget into the planner, so the hardware snapshot
 * is the quantitative knob.
 * @param {Record<string, unknown>} hardware
 * @param {number} scale
 */
function scaleHardware(hardware, scale) {
  const out = { ...hardware };
  if (Number(hardware.gpuVramGb) > 0) out.gpuVramGb = Number(hardware.gpuVramGb) * scale;
  if (Number(hardware.availableRamGb) > 0) {
    out.availableRamGb = Number(hardware.availableRamGb) * scale;
  }
  if (Number(hardware.totalRamGb) > 0) out.totalRamGb = Number(hardware.totalRamGb) * scale;
  return out;
}

/**
 * @param {string | null | undefined} cacheType
 */
function degradeCache(cacheType) {
  if (cacheType === 'q8_0') return 'q4_0';
  if (cacheType === 'q4_0') return 'q4_0';
  return 'q8_0';
}

/**
 * Re-run the planner at 85% of the last budget when we still have geometry.
 * Falls back to stepping the failed ctx down the ladder so a plan without
 * hardware still produces a Retry payload.
 * @param {DiagnosePlan} plan
 * @returns {Record<string, unknown> | undefined}
 */
function suggestedSettingsForOomVram(plan) {
  if (!plan || typeof plan !== 'object') return undefined;

  const geometry = plan.geometry;
  const weightsBytes = Number(plan.weightsBytes);
  const hardware = plan.hardware;
  if (geometry && weightsBytes > 0 && hardware && typeof hardware === 'object') {
    const next = planLlamaLaunch({
      geometry,
      weightsBytes,
      trainCtx: plan.trainCtx,
      hardware: scaleHardware(hardware, OOM_VRAM_BUDGET_SCALE),
      variant: plan.variant,
      parallel: plan.parallel,
    });
    /** @type {Record<string, unknown>} */
    const settings = {
      fit_mode: 'manual',
      ctx: next.ctx,
      cache_type: next.cache_type,
    };
    // CPU plans must keep `-ngl 0`. GPU leaves ngl unset so `--fit on` can still split.
    if (next.n_gpu_layers != null) settings.n_gpu_layers = next.n_gpu_layers;
    return settings;
  }

  const ctxPerSlot =
    Number(plan.ctxPerSlot) > 0 ? Number(plan.ctxPerSlot) : Number(plan.ctx);
  if (!(ctxPerSlot > 0)) return undefined;
  const nextCtx = snapContextToLadder(Math.floor(ctxPerSlot * OOM_VRAM_BUDGET_SCALE)) || 4096;
  /** @type {Record<string, unknown>} */
  const settings = {
    fit_mode: 'manual',
    ctx: nextCtx,
    cache_type: degradeCache(plan.cache_type),
  };
  if (plan.n_gpu_layers != null) settings.n_gpu_layers = plan.n_gpu_layers;
  return settings;
}

/**
 * @param {DiagnosePlan | null | undefined} plan
 */
function splitCountOf(plan) {
  const n = Number(plan?.splitCount);
  return n > 1 ? n : 0;
}

/**
 * @param {string} log
 * @param {number | null} exit
 * @param {DiagnosePlan | null | undefined} plan
 * @returns {LlamaFailureDiagnosis | null}
 */
function matchFailure(log, exit, plan) {
  // VRAM OOM — CUDA malloc and ggml backend alloc, plus Vulkan device alloc.
  if (
    has(log, /cudaMalloc failed:\s*out of memory/i) ||
    has(log, /ggml_backend_cuda_buffer_type_alloc_buffer/i) ||
    has(log, /ggml_vulkan:\s*Device memory allocation/i)
  ) {
    const suggestedSettings = suggestedSettingsForOomVram(plan ?? {});
    const ctxHint =
      suggestedSettings && typeof suggestedSettings.ctx === 'number'
        ? ` Suggested retry: ${suggestedSettings.ctx} context with ${suggestedSettings.cache_type} KV cache.`
        : '';
    return {
      code: 'oom_vram',
      title: 'Needs more VRAM',
      detail: `The GPU ran out of memory while loading these weights.${ctxHint}`,
      remediation:
        'Retry with the suggested context and cache type, or lower context in the Load tab. Do not reload the same settings — they will OOM again.',
      retryable: true,
      ...(suggestedSettings ? { suggestedSettings } : {}),
    };
  }

  // System RAM OOM / abort. 0xC0000409 is the Windows fast-fail llama.cpp uses when new[] fails.
  if (has(log, /std::bad_alloc/i) || exit === WIN_FASTFAIL) {
    return {
      code: 'oom_ram',
      title: 'Needs more system RAM',
      detail: 'The process ran out of system memory while loading or allocating the KV cache.',
      remediation:
        'Lower context, pick a smaller quant, or offload fewer layers to the GPU so more of the model stays on disk.',
      retryable: true,
    };
  }

  // Linux OOM killer. Prefer 137 — a null exit is too common to treat as SIGKILL.
  if (exit === UNIX_SIGKILL) {
    return {
      code: 'killed_by_os',
      title: 'Stopped by the operating system',
      detail: 'The OS killed llama-server (exit 137 / SIGKILL), usually the system memory killer.',
      remediation:
        'Treat this like a RAM shortage: lower context, pick a smaller quant, or close other heavy apps and retry.',
      retryable: true,
    };
  }

  // ARM64 llama-server on AMD64 (or the reverse) exits before any log line.
  if (
    exit === WIN_EXE_MACHINE_MISMATCH ||
    exit === WIN_BAD_EXE_FORMAT ||
    has(log, /not compatible with the version of Windows/i) ||
    has(log, /llama-server\.exe is arm64/i) ||
    has(log, /llama-server\.exe is x64/i)
  ) {
    return {
      code: 'wrong_runtime_arch',
      title: 'llama.cpp build is for a different CPU',
      detail:
        'The installed llama-server.exe cannot run on this machine, so the runtime log stays empty.',
      remediation:
        'Open Settings → Servers and Reinstall llama.cpp so Minnow downloads the zip for this CPU.',
      retryable: false,
    };
  }

  // Missing CUDA / GPU driver libs. Diagnose stays I/O-free; Settings → Servers is the fix.
  if (
    exit === WIN_DLL_NOT_FOUND ||
    (has(log, /cudart64_[\w.]+\.dll/i) && has(log, /not found/i)) ||
    has(log, /libcuda\.so\.1/i)
  ) {
    const variant = typeof plan?.variant === 'string' ? plan.variant : '';
    const cudaHint = /cuda/i.test(variant)
      ? ' If the CUDA build keeps failing, Reinstall and pick the Vulkan or CPU variant.'
      : '';
    return {
      code: 'missing_runtime_lib',
      title: 'GPU runtime library missing',
      detail:
        'llama-server could not start because a required library (CUDA runtime, libcuda, or a Windows DLL) was not found.',
      remediation: `Reinstall llama.cpp from Settings → Servers.${cudaHint}`,
      retryable: false,
    };
  }

  if (has(log, /unknown model architecture/i) || has(log, /unknown pre-tokenizer type/i)) {
    return {
      code: 'unsupported_arch',
      title: 'Needs a newer llama.cpp',
      detail: 'This GGUF uses an architecture or tokenizer the installed llama-server build does not know.',
      remediation:
        'Open Settings → Servers and Upgrade llama.cpp to the pinned build, then load the model again.',
      retryable: false,
    };
  }

  if (
    has(log, /EADDRINUSE/i) ||
    has(log, /Only one usage of each socket address/i)
  ) {
    return {
      code: 'port_conflict',
      title: 'Port already in use',
      detail: 'Another process is bound to the port llama-server tried to open.',
      remediation: 'Minnow will retry once on a fresh port. If it still fails, stop the other listener and Retry.',
      retryable: true,
    };
  }

  // minja is llama.cpp's Jinja engine. Bare "minja" also appears on success, so
  // require a parse/error nearby rather than the token alone.
  if (
    has(log, /Failed to parse chat template/i) ||
    has(log, /minja.*(?:fail|error|exception)/i) ||
    has(log, /(?:fail|error|exception).*minja/i)
  ) {
    return {
      code: 'bad_template',
      title: 'Chat template could not be parsed',
      detail: 'llama-server rejected the GGUF-embedded Jinja chat template.',
      remediation:
        'Minnow will retry once without --jinja. If it still fails, set chat_template or chat_template_file (llama-server --chat-template / --chat-template-file) on the launch settings — do not paste a guessed template.',
      retryable: true,
      // First-class keys so the UI can point at --chat-template. No suggestedSettings
      // payload: we do not invent a template, and an empty retry must not force manual.
      chatTemplateFields: ['chat_template', 'chat_template_file'],
    };
  }

  if (
    has(log, /invalid magic/i) ||
    has(log, /gguf_init_from_file failed/i) ||
    has(log, /wrong number of tensors/i)
  ) {
    const shards = splitCountOf(plan);
    const shardHint = shards
      ? ` This is a split GGUF (${shards} shards) — a missing sibling file looks like a corrupt header.`
      : '';
    return {
      code: 'corrupt_gguf',
      title: 'Weights file is unreadable',
      detail: `The GGUF header or tensor index could not be loaded.${shardHint}`,
      remediation: shards
        ? 'Re-download the model and confirm every shard (`-00001-of-N.gguf` …) is in the same folder.'
        : 'Re-download the GGUF. A truncated or edited file will not load.',
      retryable: false,
    };
  }

  if (has(log, /mmap failed/i) || has(log, /failed to open file/i)) {
    return {
      code: 'mmap_failed',
      title: 'Could not memory-map the weights',
      detail: 'llama-server failed to mmap or open the GGUF (antivirus, network drive, or locked file).',
      remediation: 'Retry with --no-mmap so the file is read instead of mapped, or copy the weights onto a local disk.',
      retryable: true,
      suggestedSettings: { extra_args: ['--no-mmap'] },
    };
  }

  // Speculative decoding with a mode that needs a draft model but has none. Verified
  // against b9628: llama-server registers the implementation and then dies in the
  // loader with **no error line at all** (SIGSEGV / STATUS_ACCESS_VIOLATION), so this
  // has to be matched on the launch settings rather than on a log signature. Last
  // before the generic fallback so any real signature above still wins.
  if (specNeedsDraftModel(plan?.spec_type, plan?.spec_draft_model)) {
    return {
      code: 'spec_missing_draft_model',
      title: 'Speculative decoding needs a draft model',
      detail: `\`${plan?.spec_type}\` drafts tokens with a second, smaller model, and no draft model was set. llama-server crashes on this rather than reporting it.`,
      remediation:
        'Pick a draft GGUF in the Load tab under Speculative decoding, or switch the mode to none. Models with MTP heads can use draft-mtp, which needs no second file.',
      retryable: false,
      suggestedSettings: { spec_type: 'none' },
    };
  }

  return null;
}

/**
 * Classify a llama-server death from its log tail and exit code.
 *
 * @param {string | null | undefined} logTail
 * @param {number | null | undefined} exitCode
 * @param {DiagnosePlan | null | undefined} plan LlamaLaunchPlan plus optional
 *   geometry / weights / hardware so VRAM OOM can re-plan quantitatively.
 * @returns {LlamaFailureDiagnosis}
 */
export function diagnoseLlamaFailure(logTail, exitCode, plan) {
  const log = String(logTail ?? '');
  const exit = unsignedExit(exitCode);
  const matched = matchFailure(log, exit, plan ?? null);
  if (matched) return matched;

  const excerpt = summarizeLlamaLogTail(log);
  return {
    code: 'unknown',
    title: 'llama-server exited',
    detail: excerpt || 'The runtime exited before it became healthy.',
    remediation: 'Retry the load, or open the runtime log on Local Server for the full stderr.',
    retryable: true,
  };
}
