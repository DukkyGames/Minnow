/**
 * S0 — Welcome: wordmark, pitch, primary CTA or skip to desktop.
 */

import { el } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep, OnboardingStepActions } from '../types';
import { recordStepProgress } from '../state-core';

export const welcomeStep: OnboardingStep = {
  id: 'welcome',
  title: 'Welcome',
  canSkip: true,

  isApplicable() {
    return true;
  },

  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--welcome';

    const hero = el('div', 'mn-onboarding-welcome-hero');
    const glyph = el('img', 'mn-onboarding-welcome-glyph') as HTMLImageElement;
    glyph.src = '/logos/minnow-glyph-white.svg';
    glyph.alt = '';
    glyph.width = 48;
    glyph.height = 48;
    hero.appendChild(glyph);

    hero.appendChild(el('h1', 'mn-onboarding-title', 'Minnow'));
    hero.appendChild(
      el('p', 'mn-onboarding-lead', 'Your local-first AI workspace'),
    );
    hero.appendChild(
      el(
        'p',
        'mn-onboarding-muted',
        'Takes about two minutes. Everything can be changed later in Settings.',
      ),
    );
    container.appendChild(hero);

    actions.setPrimaryLabel('Set up Minnow');
    actions.setPrimaryEnabled(true);
  },

  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'welcome', { done: true });
  },
};

/** Skip setup entirely — marks wizard complete without running steps. */
export function skipEntireWizard(ctx: OnboardingContext): OnboardingContext {
  return {
    ...ctx,
    state: recordStepProgress(ctx.state, 'welcome', { skipped: true, done: true }),
  };
}
