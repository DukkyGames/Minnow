/**
 * Memory enablement helpers for compose path and settings.
 */

import {
  mergeThinkingTriState,
  normalizeThinkingTriState,
  type ThinkingTriState,
} from '../agents/thinking-types';
import {
  readConfigFile,
  readConfigFlag,
  writeConfigFile,
} from '../config/config-file-cache';
import { fetchMemoryEnabled } from './client';
import type { Chat } from '../types';

/** Per-chat Brain notes injection override (inherit / on / off). */
export type BrainNotesInjectionTriState = ThinkingTriState;

export function resolveBrainNotesInjectionTriState(chat: Chat): BrainNotesInjectionTriState {
  return normalizeThinkingTriState(chat.brainNotesInjection, 'inherit');
}

/** Resolved on/off after merging chat tri-state with the global memoryInjection default. */
export function resolveBrainNotesInjectionEnabled(
  chat: Chat,
  globalDefault: boolean,
): boolean {
  const base = globalDefault ? 'on' : 'off';
  const tri = resolveBrainNotesInjectionTriState(chat);
  return mergeThinkingTriState(base, tri) === 'on';
}

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
  return readConfigFlag(['features', 'memoryInjection'], true);
}

/** Persist memory store + injection toggles (Settings / onboarding). */
export async function saveMemorySettings(options: {
  storeEnabled?: boolean;
  injectionEnabled?: boolean;
}): Promise<boolean> {
  const config = await readConfigFile({ fresh: true });
  if (!config) return false;

  if (typeof options.storeEnabled === 'boolean') {
    const memory = config.memory;
    config.memory = {
      ...(memory && typeof memory === 'object' ? (memory as Record<string, unknown>) : {}),
      enabled: options.storeEnabled,
    };
  }
  if (typeof options.injectionEnabled === 'boolean') {
    const prev = config.features;
    const features =
      prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
    features.memoryInjection = options.injectionEnabled;
    config.features = features;
  }

  return writeConfigFile(config);
}

/** Resolve whether memory retrieval should run for this send. */
export async function shouldInjectMemory(chat: Chat): Promise<boolean> {
  const globalInjectionDefault = await fetchMemoryInjectionEnabled();
  if (!resolveBrainNotesInjectionEnabled(chat, globalInjectionDefault)) {
    return false;
  }
  if (chat.kind === 'expert' && chat.expertRuntime?.memoryEnabled === false) {
    return false;
  }
  const globalEnabled = await fetchMemoryEnabled();
  return isMemoryEnabledForChat(chat, globalEnabled);
}
