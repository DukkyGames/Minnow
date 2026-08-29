/**
 * Shared output-size limits for server tools (MIN-345, MIN-667).
 * grep, process-backed tools, read_file, and git_diff share these ceilings.
 *
 * Product caps (chars/line, grep head, web bytes) are skippable via tools.json
 * `toolOutput.enabled` or per-call `full_result`. Memory guards (25 MB file,
 * 5 MB process capture) always apply.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { truncateUtf8 } from '../../src/lib/fetch-web-content.mjs';

/** Default max characters returned to agents (UTF-16 code units). */
export const DEFAULT_MAX_OUTPUT_CHARS = 128_000;

/** Max characters per emitted line before ellipsis. */
export const DEFAULT_MAX_LINE_CHARS = 2_000;

/** Clamp for persisted `toolOutput.maxChars`. */
export const TOOL_OUTPUT_MAX_CHARS_MIN = 8_000;

/** Clamp for persisted `toolOutput.maxChars`. */
export const TOOL_OUTPUT_MAX_CHARS_MAX = 2_000_000;

/**
 * Hard ceiling for reading a whole file into memory (read_file / read_file_range).
 * Larger files are refused so a single call cannot OOM the host on a huge/binary blob.
 */
export const MAX_READ_FILE_BYTES = 25 * 1024 * 1024;

/** Stop accumulating subprocess stdout/stderr beyond this byte budget. */
export const PROCESS_MAX_ACCUMULATE_BYTES = 5 * 1024 * 1024;

/** grep aliases — kept for existing imports/tests. */
export const GREP_MAX_OUTPUT_CHARS = DEFAULT_MAX_OUTPUT_CHARS;
export const GREP_MAX_LINE_CHARS = DEFAULT_MAX_LINE_CHARS;

/**
 * Per-request result-cap policy (tools.json + this-call args).
 * @typedef {{ applyResultCap: boolean, maxOutputChars: number, maxLineChars: number }} OutputCapPolicy
 */

/** @type {AsyncLocalStorage<OutputCapPolicy>} */
export const outputCapStore = new AsyncLocalStorage();

/**
 * True when the model asked to skip automatic size caps.
 * Constrained decoding uses `full_result`; `full` is accepted when a model guesses that name.
 * @param {unknown} args
 */
export function argsRequestFullResult(args) {
  if (!args || typeof args !== 'object') return false;
  const row = /** @type {Record<string, unknown>} */ (args);
  return row.full_result === true || row.full === true;
}

/**
 * Normalize persisted `toolOutput` with defaults and clamps.
 * @param {unknown} raw
 * @returns {{ enabled: boolean, maxChars: number }}
 */
export function normalizeToolOutputConfig(raw) {
  let enabled = true;
  let maxChars = DEFAULT_MAX_OUTPUT_CHARS;
  if (raw && typeof raw === 'object') {
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (typeof row.enabled === 'boolean') {
      enabled = row.enabled;
    }
    if (typeof row.maxChars === 'number' && Number.isFinite(row.maxChars)) {
      maxChars = Math.min(
        TOOL_OUTPUT_MAX_CHARS_MAX,
        Math.max(TOOL_OUTPUT_MAX_CHARS_MIN, Math.floor(row.maxChars)),
      );
    }
  }
  return { enabled, maxChars };
}

/**
 * Resolve whether this call should apply product result caps (not memory guards).
 * @param {unknown} toolOutput
 * @param {unknown} args
 * @returns {OutputCapPolicy}
 */
export function resolveOutputCapPolicy(toolOutput, args) {
  const normalized = normalizeToolOutputConfig(toolOutput);
  const applyResultCap = normalized.enabled && !argsRequestFullResult(args);
  return {
    applyResultCap,
    maxOutputChars: normalized.maxChars,
    maxLineChars: DEFAULT_MAX_LINE_CHARS,
  };
}

/** Default policy when no ALS store is active (tests and stray callers). */
function defaultOutputCapPolicy() {
  return {
    applyResultCap: true,
    maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS,
    maxLineChars: DEFAULT_MAX_LINE_CHARS,
  };
}

/** Active policy, or the on-by-default product caps. */
export function getOutputCapPolicy() {
  return outputCapStore.getStore() ?? defaultOutputCapPolicy();
}

/**
 * Run async (or sync) work with a resolved output-cap policy.
 * @template T
 * @param {OutputCapPolicy} policy
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithOutputCapPolicy(policy, fn) {
  return outputCapStore.run(policy, fn);
}

/**
 * Footer suffix pointing at the per-call opt-out (valid on capped tools).
 * @param {string} hint
 * @param {boolean} [applyResultCap]
 */
export function withFullResultFooterHint(hint, applyResultCap = getOutputCapPolicy().applyResultCap) {
  if (!applyResultCap) return hint;
  return `${hint}; or pass full_result: true`;
}

/**
 * Cap a single output line to maxLineChars with trailing ellipsis.
 * @param {string} line
 * @param {number} [maxLineChars]
 */
export function capLineLength(line, maxLineChars = DEFAULT_MAX_LINE_CHARS) {
  if (line.length <= maxLineChars) return line;
  if (maxLineChars <= 3) return line.slice(0, maxLineChars);
  return `${line.slice(0, maxLineChars - 3)}...`;
}

/**
 * Append chunk text to an accumulator without exceeding a byte budget.
 * @param {string} current
 * @param {string} chunk
 * @param {number} maxBytes
 * @returns {{ text: string, truncated: boolean }}
 */
export function appendWithByteCap(current, chunk, maxBytes = PROCESS_MAX_ACCUMULATE_BYTES) {
  const next = current + chunk;
  const nextBytes = Buffer.byteLength(next, 'utf8');
  if (nextBytes <= maxBytes) {
    return { text: next, truncated: false };
  }

  const currentBytes = Buffer.byteLength(current, 'utf8');
  if (currentBytes >= maxBytes) {
    return { text: current, truncated: true };
  }

  const remainingBytes = maxBytes - currentBytes;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chunkBytes = encoder.encode(chunk);
  let end = Math.min(remainingBytes, chunkBytes.length);
  while (end > 0 && (chunkBytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  const partial = decoder.decode(chunkBytes.slice(0, end));
  return { text: current + partial, truncated: true };
}

/**
 * Whether this call should skip product caps (explicit option wins, then ALS).
 * Passing maxOutputChars still applies a cap — tests and callers that set a budget keep it.
 * @param {{ applyResultCap?: boolean, maxOutputChars?: number }} options
 * @param {OutputCapPolicy} policy
 */
function shouldApplyTextCap(options, policy) {
  if (typeof options.applyResultCap === 'boolean') {
    return options.applyResultCap;
  }
  if (options.maxOutputChars != null) {
    return true;
  }
  return policy.applyResultCap;
}

/**
 * Cap arbitrary text: per-line length, then total char budget, then UTF-8 byte safety.
 * @param {string} text
 * @param {{
 *   maxOutputChars?: number,
 *   maxLineChars?: number,
 *   footerHint?: string,
 *   applyResultCap?: boolean,
 * }} [options]
 * @returns {{ text: string, truncated: boolean, originalChars: number }}
 */
export function capTextOutput(text, options = {}) {
  const policy = getOutputCapPolicy();
  if (!shouldApplyTextCap(options, policy)) {
    return { text, truncated: false, originalChars: text.length };
  }

  const maxOutputChars = options.maxOutputChars ?? policy.maxOutputChars;
  const maxLineChars = options.maxLineChars ?? policy.maxLineChars;

  // Baseline is the EOL-normalized length: output is always \n-joined, so measuring
  // truncation against the raw (possibly CRLF) input would flag every Windows command
  // result as truncated even when nothing was dropped.
  const lines = text.split(/\r?\n/);
  const originalChars =
    lines.reduce((sum, line) => sum + line.length, 0) +
    (lines.length > 0 ? lines.length - 1 : 0);

  let capped = lines.map((line) => capLineLength(line, maxLineChars)).join('\n');

  if (capped.length > maxOutputChars) {
    capped = capped.slice(0, maxOutputChars);
  }
  capped = truncateUtf8(capped, maxOutputChars * 4);

  const truncated = capped.length < originalChars;

  if (truncated) {
    const kept = capped.length;
    const hint = withFullResultFooterHint(
      options.footerHint ?? 'request a narrower scope or paginate',
      true,
    );
    capped = `${capped}\n[truncated — ${kept} of ${originalChars} chars; ${hint}]`;
  }

  return { text: capped, truncated, originalChars };
}

/**
 * Cap read_file output at complete lines with read_file_range guidance.
 * Explicit `maxChars` still caps (tests); otherwise ALS can skip the product cap.
 * @param {string} content
 * @param {string} relPath
 * @param {number} [maxChars]
 */
export function capReadFileOutput(content, relPath, maxChars) {
  const policy = getOutputCapPolicy();
  const apply = maxChars != null ? true : policy.applyResultCap;
  if (!apply) {
    return { text: content, truncated: false, totalLines: content.split(/\r?\n/).length };
  }

  const budget = maxChars ?? policy.maxOutputChars;
  if (content.length <= budget) {
    return { text: content, truncated: false, totalLines: content.split(/\r?\n/).length };
  }

  const lines = content.split(/\r?\n/);
  const kept = [];
  let totalChars = 0;

  for (const line of lines) {
    const added = line.length + (kept.length > 0 ? 1 : 0);
    if (totalChars + added > budget) {
      break;
    }
    kept.push(line);
    totalChars += added;
  }

  // A single line longer than the budget (e.g. minified bundle) keeps zero lines and
  // would otherwise point back at read_file_range for the same oversized line. Emit a
  // hard-truncated head instead so the caller sees something actionable.
  if (kept.length === 0 && lines.length > 0) {
    const head = lines[0].slice(0, budget);
    const text = [
      head,
      '',
      `[truncated — line 1 exceeds ${budget} chars; use grep or execute_command to inspect specific content; or pass full_result: true]`,
    ].join('\n');
    return { text, truncated: true, totalLines: lines.length };
  }

  const endLine = kept.length;
  const text = [
    kept.join('\n'),
    '',
    `[truncated — ${endLine} of ${lines.length} lines (${totalChars} of ${content.length} chars);`,
    `use read_file_range with path="${relPath}" start_line=${endLine + 1} end_line=${lines.length} for the rest; or pass full_result: true]`,
  ].join('\n');

  return { text, truncated: true, totalLines: lines.length };
}
