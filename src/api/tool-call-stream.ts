import type { ToolCallAccumulator } from '../types';

/** Highest-index streaming tool_calls entry with a non-empty function name. */
export function getLatestStreamingToolName(acc: ToolCallAccumulator): string | null {
  let bestIdx = -1;
  let bestName = '';
  for (const key of Object.keys(acc)) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) continue;
    const name = acc[idx]?.function?.name?.trim() ?? '';
    if (name && idx >= bestIdx) {
      bestIdx = idx;
      bestName = name;
    }
  }
  return bestName || null;
}
