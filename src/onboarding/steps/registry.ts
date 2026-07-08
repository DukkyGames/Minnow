/**
 * Ordered onboarding step registry (MIN-233 flow).
 */

import type { OnboardingStep } from '../types';
import { welcomeStep } from './welcome';
import { themeStep } from './theme';
import {
  providerChoiceStep,
  providerLocalStep,
  providerManagedStep,
  providerCloudStep,
} from './provider';
import { modelPickStep } from './model';
import {
  permissionsStep,
  memoryStep,
  extrasStep,
  emailStep,
  calendarStep,
  apiKeysStep,
  explainerStep,
  demoChatStep,
  doneStep,
} from './remaining';

/** Full wizard step order; controller filters with isApplicable. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  welcomeStep,
  themeStep,
  providerChoiceStep,
  providerLocalStep,
  providerManagedStep,
  providerCloudStep,
  modelPickStep,
  extrasStep,
  permissionsStep,
  memoryStep,
  emailStep,
  calendarStep,
  apiKeysStep,
  explainerStep,
  demoChatStep,
  doneStep,
];

export function getApplicableSteps(ctx: import('../types').OnboardingContext): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => step.isApplicable(ctx));
}

export function resolveStepIndex(
  steps: OnboardingStep[],
  stepId: import('../types').OnboardingStepId | null,
): number {
  if (!stepId) return 0;
  const idx = steps.findIndex((s) => s.id === stepId);
  return idx >= 0 ? idx : 0;
}
