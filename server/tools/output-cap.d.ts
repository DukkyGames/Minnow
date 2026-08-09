/** Default max characters returned to agents (UTF-16 code units). */
export const DEFAULT_MAX_OUTPUT_CHARS: number;

/** Max characters per emitted line before ellipsis. */
export const DEFAULT_MAX_LINE_CHARS: number;

/** Hard ceiling for reading a whole file into memory (read_file / read_file_range). */
export const MAX_READ_FILE_BYTES: number;

/** Stop accumulating subprocess stdout/stderr beyond this byte budget. */
export const PROCESS_MAX_ACCUMULATE_BYTES: number;

/** grep aliases — kept for existing imports/tests. */
export const GREP_MAX_OUTPUT_CHARS: number;
export const GREP_MAX_LINE_CHARS: number;

/** Cap a single output line to maxLineChars with trailing ellipsis. */
export function capLineLength(line: string, maxLineChars?: number): string;

/** Cap arbitrary text: per-line length, then total char budget, then UTF-8 byte safety. */
export function capTextOutput(
  text: string,
  options?: {
    maxOutputChars?: number;
    maxLineChars?: number;
    footerHint?: string;
  },
): { text: string; truncated: boolean; originalChars: number };

/** Cap read_file output at complete lines with read_file_range guidance. */
export function capReadFileOutput(
  content: string,
  relPath: string,
  maxChars?: number,
): { text: string; truncated: boolean; totalLines: number };
