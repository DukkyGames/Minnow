/**
 * Pure repetition heuristics for sub-agent runs (Step 19).
 */

export type RepetitionReason =
  | 'duplicate_tool'
  | 'same_error'
  | 'no_progress'
  | 'loop';

export interface ToolCallLogEntry {
  name: string;
  argsJson: string;
}

export interface DetectionResult {
  repeated: boolean;
  reason: RepetitionReason;
  fingerprint: string;
}

export interface DetectorThresholds {
  duplicateToolCallThreshold: number;
  sameErrorThreshold: number;
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return `sh_${Math.abs(hash)}`;
}

function normalizeArgsJson(argsJson: string): string {
  try {
    const parsed = JSON.parse(argsJson);
    const sortKeys = (v: unknown): unknown => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = sortKeys((v as Record<string, unknown>)[key]);
            return acc;
          }, {});
      }
      return v;
    };
    return JSON.stringify(sortKeys(parsed));
  } catch {
    return argsJson;
  }
}

/** Detect duplicate tool calls with identical normalized args. */
export function detectRepetition(
  log: ToolCallLogEntry[],
  thresholds: DetectorThresholds,
): DetectionResult | null {
  if (log.length < thresholds.duplicateToolCallThreshold) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const entry of log) {
    const key = `${entry.name}::${normalizeArgsJson(entry.argsJson)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) >= thresholds.duplicateToolCallThreshold) {
      const fingerprint = stableHash(
        `duplicate_tool:${entry.name}:${normalizeArgsJson(entry.argsJson)}`,
      );
      return {
        repeated: true,
        reason: 'duplicate_tool',
        fingerprint,
      };
    }
  }

  return null;
}
