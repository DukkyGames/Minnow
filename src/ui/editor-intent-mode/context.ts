/**
 * Pure context + staleness helpers for Intent mode (ported from prototype).
 */

import type { IntentRegion } from './types';

/** Deterministic string hash for context drift detection. */
export function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Hash surrounding resolved context plus the intent line. */
export function contextHash(above: string[], intentLine: string, below: string[]): string {
  return simpleHash([...above, intentLine, ...below].join('\n'));
}

/** Collect resolved line indices (0-based) from region ranges. */
export function resolvedLineIndices(
  docText: string,
  regions: IntentRegion[],
): Set<number> {
  const lines = docText.split('\n');
  const indices = new Set<number>();
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineStart = offset;
    const lineEnd = offset + lines[i].length;
    for (const region of regions) {
      if (region.from <= lineStart && region.to >= lineEnd) {
        indices.add(i);
        break;
      }
    }
    offset = lineEnd + 1;
  }
  return indices;
}

/** Build above/below arrays of resolved neighbor lines within the context window. */
export function resolvedContext(
  lines: string[],
  lineIndex: number,
  resolvedLines: Set<number>,
  contextWindow: number,
): { above: string[]; below: string[] } {
  const above: string[] = [];
  const below: string[] = [];
  const start = Math.max(0, lineIndex - contextWindow);
  for (let i = start; i < lineIndex; i += 1) {
    if (resolvedLines.has(i)) above.push(lines[i]);
  }
  const end = Math.min(lines.length - 1, lineIndex + contextWindow);
  for (let i = lineIndex + 1; i <= end; i += 1) {
    if (resolvedLines.has(i)) below.push(lines[i]);
  }
  return { above, below };
}

/** Compute context hash for a region at resolve/re-check time. */
export function contextHashForRegion(
  docText: string,
  regions: IntentRegion[],
  region: IntentRegion,
  contextWindow: number,
): string {
  const lines = docText.split('\n');
  const resolved = resolvedLineIndices(
    docText,
    regions.filter((r) => r.from !== region.from || r.to !== region.to),
  );
  let lineIndex = 0;
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (offset === region.from) {
      lineIndex = i;
      break;
    }
    offset += lines[i].length + 1;
  }
  const { above, below } = resolvedContext(lines, lineIndex, resolved, contextWindow);
  return contextHash(above, region.intentText, below);
}

/** Recompute stale flags by comparing stored ctxHash to current neighbor context. */
export function withStale(
  docText: string,
  regions: IntentRegion[],
  contextWindow: number,
): IntentRegion[] {
  return regions.map((region) => {
    const nextHash = contextHashForRegion(docText, regions, region, contextWindow);
    return {
      ...region,
      stale: region.ctxHash !== nextHash,
    };
  });
}

/** True when a document change range intersects a region span. */
export function changeIntersectsRegion(
  changeFrom: number,
  changeTo: number,
  regionFrom: number,
  regionTo: number,
): boolean {
  return changeFrom < regionTo && changeTo > regionFrom;
}
