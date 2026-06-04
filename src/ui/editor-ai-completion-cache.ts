/**
 * In-memory cache keys for editor AI inline completions (Phase 4).
 */

/** Stable hash for cache keys (djb2 → base36). */
export function hashCompletionContext(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Cache key from file path + prefix tail + suffix head. */
export function buildCompletionCacheKey(
  filePath: string,
  prefix: string,
  suffix: string,
): string {
  const prefixTail = prefix.slice(-512);
  const suffixHead = suffix.slice(0, 512);
  return hashCompletionContext(`${filePath}\0${prefixTail}\0${suffixHead}`);
}
