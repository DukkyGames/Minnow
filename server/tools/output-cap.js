/**
 * Shared output-size limits for server tools (MIN-345).
 * grep, process-backed tools, read_file, and git_diff share these ceilings.
 */

import { truncateUtf8 } from '../../src/lib/fetch-web-content.mjs';

/** Default max characters returned to agents (UTF-16 code units). */
export const DEFAULT_MAX_OUTPUT_CHARS = 32_000;

/** Max characters per emitted line before ellipsis. */
export const DEFAULT_MAX_LINE_CHARS = 400;

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
 * Cap arbitrary text: per-line length, then total char budget, then UTF-8 byte safety.
 * @param {string} text
 * @param {{
 *   maxOutputChars?: number,
 *   maxLineChars?: number,
 *   footerHint?: string,
 * }} [options]
 * @returns {{ text: string, truncated: boolean, originalChars: number }}
 */
export function capTextOutput(text, options = {}) {
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;

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
    const hint = options.footerHint ?? 'request a narrower scope or paginate';
    capped = `${capped}\n[truncated — ${kept} of ${originalChars} chars; ${hint}]`;
  }

  return { text: capped, truncated, originalChars };
}

/**
 * Cap read_file output at complete lines with read_file_range guidance.
 * @param {string} content
 * @param {string} relPath
 * @param {number} [maxChars]
 */
export function capReadFileOutput(content, relPath, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  if (content.length <= maxChars) {
    return { text: content, truncated: false, totalLines: content.split(/\r?\n/).length };
  }

  const lines = content.split(/\r?\n/);
  const kept = [];
  let totalChars = 0;

  for (const line of lines) {
    const added = line.length + (kept.length > 0 ? 1 : 0);
    if (totalChars + added > maxChars) {
      break;
    }
    kept.push(line);
    totalChars += added;
  }

  // A single line longer than the budget (e.g. minified bundle) keeps zero lines and
  // would otherwise point back at read_file_range for the same oversized line. Emit a
  // hard-truncated head instead so the caller sees something actionable.
  if (kept.length === 0 && lines.length > 0) {
    const head = lines[0].slice(0, maxChars);
    const text = [
      head,
      '',
      `[truncated — line 1 exceeds ${maxChars} chars; use grep or execute_command to inspect specific content]`,
    ].join('\n');
    return { text, truncated: true, totalLines: lines.length };
  }

  const endLine = kept.length;
  const text = [
    kept.join('\n'),
    '',
    `[truncated — ${endLine} of ${lines.length} lines (${totalChars} of ${content.length} chars);`,
    `use read_file_range with path="${relPath}" start_line=${endLine + 1} end_line=${lines.length} for the rest]`,
  ].join('\n');

  return { text, truncated: true, totalLines: lines.length };
}
