/**
 * Pure onboarding state helpers (no I/O) — safe for unit tests.
 */

import type { OnboardingContext, OnboardingPersistedState, OnboardingStepId } from './types';

/** Provider ids seeded on first `npm start` — not treated as user configuration. */
export const ONBOARDING_SEED_PROVIDER_IDS = new Set([
  'lm-studio-local',
  'llama-cpp-local',
  'vite-fallback',
]);

/** True when the user added a provider beyond the shipped seed rows. */
export function hasUserConfiguredProviderIds(providerIds: readonly string[]): boolean {
  return providerIds.some((id) => !ONBOARDING_SEED_PROVIDER_IDS.has(id));
}

/** True when persisted chats contain real messages (not just model binding). */
export function hasExistingChatMessageHistory(
  chats: ReadonlyArray<{ history?: readonly unknown[] }> | undefined,
): boolean {
  if (!chats?.length) return false;
  return chats.some((chat) => (chat.history?.length ?? 0) > 0);
}

/** Empty wizard state for first launch. */
export function createDefaultOnboardingState(): OnboardingPersistedState {
  return {
    version: 1,
    completedAt: null,
    lastStep: null,
    overlayClaimedAt: null,
    steps: {},
  };
}

export function isOnboardingComplete(state: OnboardingPersistedState): boolean {
  return Boolean(state.completedAt);
}

interface OnboardingStepRecordPatch {
  done?: boolean;
  skipped?: boolean;
  data?: Record<string, unknown>;
}

export function recordStepProgress(
  state: OnboardingPersistedState,
  stepId: OnboardingStepId,
  patch: OnboardingStepRecordPatch,
): OnboardingPersistedState {
  const prev = state.steps[stepId] ?? {};
  return {
    ...state,
    lastStep: stepId,
    steps: {
      ...state.steps,
      [stepId]: {
        ...prev,
        ...patch,
        data: patch.data ? { ...(prev.data ?? {}), ...patch.data } : prev.data,
      },
    },
  };
}

/** Build runtime context from persisted state + boot probes. */
export function buildOnboardingContext(
  state: OnboardingPersistedState,
  options: { serverAvailable: boolean; configServerAvailable: boolean },
): OnboardingContext {
  const themeStep = state.steps.theme?.data ?? {};
  const providerStep =
    state.steps['provider-local']?.data ??
    state.steps['provider-cloud']?.data ??
    state.steps['provider-managed']?.data ??
    state.steps['provider-choice']?.data ??
    {};
  const modelStep = state.steps['model-pick']?.data ?? {};

  return {
    state,
    providerPath:
      (providerStep.path as OnboardingContext['providerPath']) ??
      (state.steps['provider-choice']?.data?.path as OnboardingContext['providerPath']) ??
      null,
    providerId: (providerStep.providerId as string) ?? (modelStep.providerId as string) ?? null,
    modelId: (modelStep.modelId as string) ?? null,
    themeMode: (themeStep.mode as OnboardingContext['themeMode']) ?? null,
    themeFamily: (themeStep.family as OnboardingContext['themeFamily']) ?? null,
    wallpaper: (themeStep.wallpaper as OnboardingContext['wallpaper']) ?? null,
    searxngSkipped: Boolean(state.steps.extras?.data?.searxngSkipped),
    serverAvailable: options.serverAvailable,
    configServerAvailable: options.configServerAvailable,
  };
}
