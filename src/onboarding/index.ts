/**
 * Onboarding wizard public API.
 */

import '../styles/onboarding.css';

export {
  mountOnboarding,
  unmountOnboarding,
  shouldShowOnboardingOnBoot,
  rerunOnboardingFromSettings,
  isOnboardingMounted,
} from './controller';

export { loadOnboardingState, resetOnboardingForRerun, isOnboardingComplete } from './state';
