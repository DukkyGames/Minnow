/**
 * S0 — Welcome: wordmark, pitch, setup preview, primary CTA or skip.
 */

import { el } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep, OnboardingStepActions } from '../types';
import { recordStepProgress } from '../state-core';

const SETUP_TOPICS = ['Appearance', 'Models', 'Permissions', '~2 min'];

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

    const glow = el('div', 'mn-onboarding-welcome-glow');
    const glyph = el('img', 'mn-onboarding-welcome-glyph') as HTMLImageElement;
    glyph.src = '/logos/minnow-glyph.svg';
    glyph.alt = '';
    glyph.width = 56;
    glyph.height = 56;
    glow.appendChild(glyph);
    hero.appendChild(glow);

    hero.appendChild(el('h1', 'mn-onboarding-title', 'Minnow'));
    hero.appendChild(
      el('p', 'mn-onboarding-lead', 'Your local-first AI workspace'),
    );
    hero.appendChild(
      el(
        'p',
        'mn-onboarding-muted',
        'A short walkthrough to connect models, set permissions, and learn the apps. Everything can be changed later in Settings.',
      ),
    );

    const pills = el('ul', 'mn-onboarding-welcome-pills');
    SETUP_TOPICS.forEach((topic) => {
      const pill = el('li', 'mn-onboarding-welcome-pill', topic);
      pills.appendChild(pill);
    });
    hero.appendChild(pills);

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
