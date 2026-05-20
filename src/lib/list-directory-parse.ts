/**
 * Pure parser for list_directory tool output (one entry per line).
 */

export interface ParsedListing {
  dirs: string[];
  files: string[];
}

export type ListDirectoryParseResult = ParsedListing | { error: string };

const EMPTY_MARKER = '(empty directory)';

/** Parse raw tool string into sorted directory and file name lists. */
export function parseListDirectoryResult(raw: string): ListDirectoryParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { dirs: [], files: [] };
  }

  if (trimmed.startsWith('Error:')) {
    return { error: trimmed.replace(/^Error:\s*/i, '').trim() };
  }

  if (trimmed === EMPTY_MARKER) {
    return { dirs: [], files: [] };
  }

  const dirs: string[] = [];
  const files: string[] = [];

  for (const line of trimmed.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    if (row.startsWith('[dir] ')) {
      dirs.push(row.slice(6).trim());
    } else if (row.startsWith('[file] ')) {
      files.push(row.slice(7).trim());
    }
  }

  dirs.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));

  return { dirs, files };
}
