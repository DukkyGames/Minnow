/**
 * Brain wiki tool ids (keep in sync with server/config/tool-ids.js).
 * Seeded at permission `full` on first run and back-filled on config load.
 */

export const BRAIN_WIKI_TOOL_IDS = [
  'brain_search',
  'brain_read_page',
  'brain_list',
  'brain_write_page',
  'brain_append_log',
  'brain_ingest_source',
  'save_memory',
] as const;

export const BRAIN_WIKI_TOOL_ID_SET = new Set<string>(BRAIN_WIKI_TOOL_IDS);
