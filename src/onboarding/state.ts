/**
 * Onboarding persistence — server file wins over localStorage mirror.
 */

import { isServerStorageMode } from '../config/storage-mode';
import { listProviders } from '../providers/store';
import { sessionState } from '../state/sessions';
import type { OnboardingPersistedState } from './types';
import {
  buildOnboardingContext,
  createDefaultOnboardingState,
  isOnboardingComplete,
  recordStepProgress,
} from './state-core';

export {
  buildOnboardingContext,
  createDefaultOnboardingState,
  isOnboardingComplete,
  recordStepProgress,
} from './state-core';

const STORAGE_KEY = 'minnow.onboarding.v1';
const CONFIG_KEY = 'onboarding.json';

const DEFAULT_SEED_PROVIDER_IDS = new Set(['lm-studio-local', 'llama-cpp-managed']);

function readLocalMirror(): OnboardingPersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingPersistedState;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalMirror(state: OnboardingPersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function readServerState(): Promise<OnboardingPersistedState | null> {
  if (!isServerStorageMode()) return null;
  try {
    const res = await fetch(`/api/config/file?key=${encodeURIComponent(CONFIG_KEY)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as OnboardingPersistedState;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeServerState(state: OnboardingPersistedState): Promise<void> {
  if (!isServerStorageMode()) return;
  await fetch(`/api/config/file?key=${encodeURIComponent(CONFIG_KEY)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

/** Load merged onboarding state (server file overrides local mirror). */
export async function loadOnboardingState(): Promise<OnboardingPersistedState> {
  const [server, local] = await Promise.all([
    readServerState(),
    Promise.resolve(readLocalMirror()),
  ]);
  return server ?? local ?? createDefaultOnboardingState();
}

/** Persist wizard progress to both stores when possible. */
export async function saveOnboardingState(state: OnboardingPersistedState): Promise<void> {
  writeLocalMirror(state);
  await writeServerState(state);
}

/** Mark wizard complete and persist. */
export async function markOnboardingComplete(
  state: OnboardingPersistedState,
): Promise<OnboardingPersistedState> {
  const next: OnboardingPersistedState = {
    ...state,
    completedAt: new Date().toISOString(),
    lastStep: 'done',
  };
  await saveOnboardingState(next);
  return next;
}

/** Reset wizard so Settings → Run setup again re-opens it. */
export async function resetOnboardingForRerun(): Promise<OnboardingPersistedState> {
  const next = createDefaultOnboardingState();
  await saveOnboardingState(next);
  return next;
}

function hasRealChatHistory(): boolean {
  if (!sessionState?.chats?.length) return false;
  return sessionState.chats.some(
    (chat) =>
      (chat.history?.length ?? 0) > 0 ||
      Boolean(chat.modelId?.trim()) ||
      Boolean(chat.providerId?.trim()),
  );
}

async function hasUserConfiguredProviders(): Promise<boolean> {
  try {
    const { providers } = await listProviders();
    return providers.some((p) => !DEFAULT_SEED_PROVIDER_IDS.has(p.id));
  } catch {
    return false;
  }
}

/**
 * Existing installs: silently mark complete when chats or custom providers exist.
 * Returns updated state (may be unchanged).
 */
export async function migrateExistingUsersIfNeeded(
  state: OnboardingPersistedState,
): Promise<OnboardingPersistedState> {
  if (state.completedAt) return state;
  const [customProviders, chatHistory] = await Promise.all([
    hasUserConfiguredProviders(),
    Promise.resolve(hasRealChatHistory()),
  ]);
  if (!customProviders && !chatHistory) return state;
  return markOnboardingComplete(state);
}

/** Try to claim overlay for this window (second window should not mount). */
export async function tryClaimOnboardingOverlay(
  state: OnboardingPersistedState,
): Promise<{ claimed: boolean; state: OnboardingPersistedState }> {
  if (state.overlayClaimedAt) {
    const ageMs = Date.now() - Date.parse(state.overlayClaimedAt);
    if (ageMs < 30_000) return { claimed: false, state };
  }
  const next = { ...state, overlayClaimedAt: new Date().toISOString() };
  await saveOnboardingState(next);
  return { claimed: true, state: next };
}

export async function releaseOnboardingOverlayClaim(
  state: OnboardingPersistedState,
): Promise<OnboardingPersistedState> {
  const next = { ...state, overlayClaimedAt: null };
  await saveOnboardingState(next);
  return next;
}
