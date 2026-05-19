/**
 * Memory enablement helpers for compose path and settings.
 */

import { fetchMemoryEnabled } from './client';
import type { Chat } from '../types';

/** Per-chat override: null = follow global. */
export function isMemoryEnabledForChat(
  chat: Chat,
  globalEnabled: boolean,
): boolean {
  const row = chat as Chat & { memoryEnabled?: boolean | null };
  if (row.memoryEnabled === true) return true;
  if (row.memoryEnabled === false) return false;
  return globalEnabled;
}

/** Resolve whether memory injection should run for this send. */
export async function shouldInjectMemory(chat: Chat): Promise<boolean> {
  const globalEnabled = await fetchMemoryEnabled();
  return isMemoryEnabledForChat(chat, globalEnabled);
}
