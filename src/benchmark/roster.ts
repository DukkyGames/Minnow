/**
 * Multi-model roster for benchmark campaigns (session persistence).
 */

import { decodeModelSelectKey } from '../lib/model-select-key.ts';
import { getActiveChat } from '../state/sessions.ts';
import type { BenchmarkTarget } from './campaign-types.ts';
import { ROSTER_STORAGE_KEY } from './campaign-types.ts';
import { getActiveModelIdFromDom } from './resolve-binding.ts';

function readRoster(): BenchmarkTarget[] {
  try {
    const raw = sessionStorage.getItem(ROSTER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BenchmarkTarget[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRoster(targets: BenchmarkTarget[]): void {
  sessionStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(targets));
}

/** Active top-bar model as a benchmark target. */
export function getActiveTargetFromDom(): BenchmarkTarget | null {
  const raw = getActiveModelIdFromDom();
  const parsed = decodeModelSelectKey(raw);
  const chat = getActiveChat();
  const modelId = parsed?.modelId ?? raw;
  const providerId = parsed?.providerId ?? chat.providerId?.trim();
  if (!modelId || !providerId) return null;
  return { providerId, modelId };
}

/** Load roster; seed with active model when empty. */
export function loadRoster(): BenchmarkTarget[] {
  const existing = readRoster();
  if (existing.length) return existing;
  const active = getActiveTargetFromDom();
  return active ? [active] : [];
}

export function saveRoster(targets: BenchmarkTarget[]): void {
  writeRoster(targets);
}

export function addTargetToRoster(target: BenchmarkTarget): BenchmarkTarget[] {
  const key = `${target.providerId}::${target.modelId}`;
  const next = loadRoster().filter(
    (t) => `${t.providerId}::${t.modelId}` !== key,
  );
  next.push(target);
  writeRoster(next);
  return next;
}

export function removeTargetFromRoster(providerId: string, modelId: string): BenchmarkTarget[] {
  const key = `${providerId}::${modelId}`;
  const next = loadRoster().filter((t) => `${t.providerId}::${t.modelId}` !== key);
  writeRoster(next);
  return next;
}
