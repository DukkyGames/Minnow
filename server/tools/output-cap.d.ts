/** Default max characters returned to agents (UTF-16 code units). */
export const DEFAULT_MAX_OUTPUT_CHARS: number;

/** Max characters per emitted line before ellipsis. */
export const DEFAULT_MAX_LINE_CHARS: number;

/** Clamp for persisted toolOutput.maxChars. */
export const TOOL_OUTPUT_MAX_CHARS_MIN: number;
export const TOOL_OUTPUT_MAX_CHARS_MAX: number;

/** Hard ceiling for reading a whole file into memory (read_file / read_file_range). */
export const MAX_READ_FILE_BYTES: number;

/** Stop accumulating subprocess stdout/stderr beyond this byte budget. */
export const PROCESS_MAX_ACCUMULATE_BYTES: number;

/** grep aliases — kept for existing imports/tests. */
export const GREP_MAX_OUTPUT_CHARS: number;
export const GREP_MAX_LINE_CHARS: number;

export type OutputCapPolicy = {
  applyResultCap: boolean;
  maxOutputChars: number;
  maxLineChars: number;
};

export type ToolOutputConfig = {
  enabled: boolean;
  maxChars: number;
};

export function argsRequestFullResult(args: unknown): boolean;

export function normalizeToolOutputConfig(raw: unknown): ToolOutputConfig;

export function resolveOutputCapPolicy(toolOutput: unknown, args: unknown): OutputCapPolicy;

export function getOutputCapPolicy(): OutputCapPolicy;

export function runWithOutputCapPolicy<T>(policy: OutputCapPolicy, fn: () => T): T;

export function withFullResultFooterHint(hint: string, applyResultCap?: boolean): string;

/** Cap a single output line to maxLineChars with trailing ellipsis. */
export function capLineLength(line: string, maxLineChars?: number): string;

export function appendWithByteCap(
  current: string,
  chunk: string,
  maxBytes?: number,
): { text: string; truncated: boolean };

/** Cap arbitrary text: per-line length, then total char budget, then UTF-8 byte safety. */
export function capTextOutput(
  text: string,
  options?: {
    maxOutputChars?: number;
    maxLineChars?: number;
    footerHint?: string;
    applyResultCap?: boolean;
  },
): { text: string; truncated: boolean; originalChars: number };

/** Cap read_file output at complete lines with read_file_range guidance. */
export function capReadFileOutput(
  content: string,
  relPath: string,
  maxChars?: number,
): { text: string; truncated: boolean; totalLines: number };
