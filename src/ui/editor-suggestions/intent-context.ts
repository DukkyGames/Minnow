/**
 * Intent neighbor context and staleness hashing (Track C).
 * Prompt context uses real neighboring source lines; staleness hashes use
 * resolved-neighbor lines only.
 */

import type { Text } from '@codemirror/state';

/** Metadata for code that replaced an intent line after accept. */
export interface IntentRegion {
  from: number;
  to: number;
  intentText: string;
  ctxHash: string;
  stale: boolean;
}

/** Deterministic string hash for context drift detection. */
export function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Hash surrounding context plus the intent line. */
export function contextHash(above: string[], intentLine: string, below: string[]): string {
  return simpleHash([...above, intentLine, ...below].join('\n'));
}

/** Actual source lines above/below the intent line within the context window. */
export function neighborLinesForPrompt(
  doc: Text,
  lineNumber: number,
  contextWindow: number,
): { above: string[]; below: string[] } {
  const above: string[] = [];
  const below: string[] = [];
  const start = Math.max(1, lineNumber - contextWindow);
  for (let n = start; n < lineNumber; n += 1) {
    above.push(doc.line(n).text);
  }
  const end = Math.min(doc.lines, lineNumber + contextWindow);
  for (let n = lineNumber + 1; n <= end; n += 1) {
    below.push(doc.line(n).text);
  }
  return { above, below };
}

/** 1-based line numbers that are fully covered by a resolved intent region. */
export function resolvedLineNumbers(doc: Text, regions: IntentRegion[]): Set<number> {
  const numbers = new Set<number>();
  for (const region of regions) {
    const line = doc.lineAt(region.from);
    const endLine = doc.lineAt(Math.min(region.to, doc.length));
    for (let n = line.number; n <= endLine.number; n += 1) {
      numbers.add(n);
    }
  }
  return numbers;
}

/**
 * Lines within the window that are already resolved (for staleness hashing only).
 */
export function resolvedNeighborLines(
  doc: Text,
  lineNumber: number,
  resolvedLines: Set<number>,
  contextWindow: number,
): { above: string[]; below: string[] } {
  const above: string[] = [];
  const below: string[] = [];
  const start = Math.max(1, lineNumber - contextWindow);
  for (let n = start; n < lineNumber; n += 1) {
    if (resolvedLines.has(n)) above.push(doc.line(n).text);
  }
  const end = Math.min(doc.lines, lineNumber + contextWindow);
  for (let n = lineNumber + 1; n <= end; n += 1) {
    if (resolvedLines.has(n)) below.push(doc.line(n).text);
  }
  return { above, below };
}

/** Compute context hash for a region (resolved neighbors only). */
export function contextHashForRegion(
  doc: Text,
  regions: IntentRegion[],
  region: IntentRegion,
  contextWindow: number,
): string {
  const lineNumber = doc.lineAt(region.from).number;
  const others = regions.filter((r) => r.from !== region.from || r.to !== region.to);
  const resolved = resolvedLineNumbers(doc, others);
  const { above, below } = resolvedNeighborLines(doc, lineNumber, resolved, contextWindow);
  return contextHash(above, region.intentText, below);
}

/** Recompute stale flags for regions whose context hash drifted. */
export function withStaleRegions(
  doc: Text,
  regions: IntentRegion[],
  contextWindow: number,
): IntentRegion[] {
  return regions.map((region) => {
    const nextHash = contextHashForRegion(doc, regions, region, contextWindow);
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

/** True when any changed range in the doc intersects a region's line window. */
export function docChangeTouchesRegionWindow(
  doc: Text,
  region: IntentRegion,
  contextWindow: number,
  changeFrom: number,
  changeTo: number,
): boolean {
  const lineNumber = doc.lineAt(region.from).number;
  const start = Math.max(1, lineNumber - contextWindow);
  const end = Math.min(doc.lines, lineNumber + contextWindow);
  const windowFrom = doc.line(start).from;
  const windowTo = doc.line(end).to;
  return changeIntersectsRegion(changeFrom, changeTo, windowFrom, windowTo);
}
