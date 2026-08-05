/**
 * Per-workspace issue key helpers (Linear-style KEY-n ids).
 */

/** User-visible validation message when a project key is invalid. */
export const PROJECT_KEY_VALIDATION_MESSAGE = 'Use 2–10 letters or numbers.';

const PROJECT_KEY_PATTERN = /^[A-Z0-9]{2,10}$/;

/** Strip and uppercase for storage; removes invalid characters. */
export function normalizeProjectKeyInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Returns an error string when invalid, otherwise null. */
export function validateProjectKey(raw: string): string | null {
  const key = normalizeProjectKeyInput(raw);
  if (!PROJECT_KEY_PATTERN.test(key)) return PROJECT_KEY_VALIDATION_MESSAGE;
  return null;
}

/** Split basename into word segments (kebab, snake, dots, spaces, camelCase). */
function splitBasenameSegments(basename: string): string[] {
  const camelSpaced = basename.replace(/([a-z])([A-Z])/g, '$1 $2');
  return camelSpaced.split(/[-_.\s]+/).filter((part) => part.length > 0);
}

/**
 * Suggest a project key from the workspace folder label (basename users see).
 * Multi-word → initials; single word → first three letters when length ≥ 3.
 */
export function suggestProjectKey(workspaceLabelOrBasename: string): string {
  const trimmed = workspaceLabelOrBasename.trim();
  if (!trimmed) return 'ISS';

  const segments = splitBasenameSegments(trimmed);
  let rawKey: string;

  if (segments.length > 1) {
    rawKey = segments
      .map((segment) => {
        const alnum = segment.replace(/[^a-zA-Z0-9]/g, '');
        return alnum[0] ?? '';
      })
      .join('');
  } else {
    const alnum = (segments[0] ?? trimmed).replace(/[^a-zA-Z0-9]/g, '');
    if (alnum.length >= 3) {
      rawKey = alnum.slice(0, 3);
    } else {
      rawKey = alnum.slice(0, 10);
    }
  }

  const key = rawKey.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (key.length < 2) return 'ISS';
  return key;
}

/** Parse `KEY-n` issue ids (any uppercase prefix). */
export function parseKeyedIssueId(
  id: string,
): { prefix: string; number: number } | null {
  const match = /^([A-Z0-9]+)-(\d+)$/i.exec(id.trim());
  if (!match) return null;
  return {
    prefix: match[1].toUpperCase(),
    number: Number.parseInt(match[2], 10) || 0,
  };
}

/** Numeric suffix for sorting; non-matching ids sort as 0 with full-id tie-break elsewhere. */
export function issueIdNumericSuffix(id: string): number {
  const parsed = parseKeyedIssueId(id);
  return parsed?.number ?? 0;
}

/** Prefix segment for sorting keyed ids (empty when not KEY-n). */
export function issueIdKeyPrefix(id: string): string {
  const parsed = parseKeyedIssueId(id);
  return parsed?.prefix ?? '';
}
