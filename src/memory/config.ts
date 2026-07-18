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

/**
 * Whether prompt injection should run (Settings → Features → Memory injection).
 * Defaults to true when unset.
 */
export async function fetchMemoryInjectionEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/config/file?key=config.json', {
      cache: 'no-store',
    });
    if (!res.ok) return true;
    const config = (await res.json()) as {
      features?: { memoryInjection?: boolean };
    };
    const features = config.features;
    if (features && typeof features.memoryInjection === 'boolean') {
      return features.memoryInjection;
    }
    return true;
  } catch {
    return true;
  }
}

/** Resolve whether memory retrieval should run for this send. */
export async function shouldInjectMemory(chat: Chat): Promise<boolean> {
  const injectionOn = await fetchMemoryInjectionEnabled();
  if (!injectionOn) return false;
  if (chat.kind === 'expert' && chat.expertRuntime?.memoryEnabled === false) {
    return false;
  }
  const globalEnabled = await fetchMemoryEnabled();
  return isMemoryEnabledForChat(chat, globalEnabled);
}
