/** Max tags accepted from the settings add-memory form (server has no hard cap). */
export const MEMORY_TAGS_MAX = 20;

/** Parse comma-separated tags from manual memory entry UI. */
export function parseMemoryTagsInput(raw: string, max = MEMORY_TAGS_MAX): string[] {
  const tags = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.slice(0, max);
}
