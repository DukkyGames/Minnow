/**
 * Agent-facing memory tools — persist notes under ~/.minnow/memory/.
 */

import { createEntry, loadMemoryConfig } from '../memory/store.js';

/**
 * Save a durable memory entry (source: agent).
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
export async function toolSaveMemory(args) {
  const memory = await loadMemoryConfig();
  if (memory.enabled === false) {
    return 'Error: Memory store is disabled in Settings → Memory.';
  }

  const title = String(args?.title ?? '').trim();
  const body = String(args?.body ?? '').trim();
  if (!title) {
    return 'Error: title is required.';
  }
  if (!body) {
    return 'Error: body is required.';
  }

  const tags = Array.isArray(args?.tags)
    ? args.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const entry = await createEntry({
    title,
    body,
    tags,
    source: 'agent',
  });

  return `Saved memory "${entry.title}" (id: ${entry.id}) under pages/facts/. It will appear in future chats when Brain retrieval runs.`;
}
