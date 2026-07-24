/**
 * S0 — Welcome: editorial intro. Left column carries the creator's note (the
 * voice); right column previews what setup covers (the plan). Primary CTA and
 * skip live in the controller footer.
 */

import { MINNOW_GLYPH_HEADER_HTML } from '../../ui/minnow-glyph';
import { el } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

const DISCORD_INVITE_URL = 'https://discord.gg/U4FPzv9K4X';

/** The three settings setup actually walks through, previewed up front. */
const SETUP_PREVIEW: ReadonlyArray<{ name: string; desc: string }> = [
  { name: 'Appearance', desc: 'Pick a theme and make it yours.' },
  { name: 'Models', desc: 'Connect the models you’ll build with.' },
  { name: 'Permissions', desc: 'Set what your agents can do.' },
];

/** Identity, the personal note, and the signature. */
function renderVoice(): HTMLElement {
  const voice = el('div', 'mn-onboarding-welcome__voice');

  const brand = el('div', 'mn-onboarding-welcome__brand');
  const logo = el('div', 'mn-onboarding-welcome__logo');
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = MINNOW_GLYPH_HEADER_HTML;
  brand.appendChild(logo);

  const wordmarkBlock = el('div', 'mn-onboarding-welcome__wordmark-block');
  wordmarkBlock.appendChild(el('h1', 'mn-onboarding-welcome__wordmark', 'Minnow'));
  wordmarkBlock.appendChild(
    el('p', 'mn-onboarding-welcome__tagline', 'An AI workspace for Everyone.'),
  );
  brand.appendChild(wordmarkBlock);
  voice.appendChild(brand);

  const letter = el('div', 'mn-onboarding-welcome__letter');
  letter.appendChild(
    el('p', 'mn-onboarding-welcome__letter-lead', 'Hi, welcome to Minnow.'),
  );
  letter.appendChild(
    el(
      'p',
      undefined,
      'I built Minnow because AI should feel accessible, not locked behind someone else’s gate. Linus Torvalds (Linux) and Ton Roosendaal (Blender) showed what happens when powerful tools stay open, and personally, I don’t think a closed model of AI serves people well in the long run. This is a place where anyone can make anything, freely and openly.',
    ),
  );

  const wip = el('p');
  wip.appendChild(
    document.createTextNode(
      'It’s early and still rough in places. If something breaks or feels off, tell us on ',
    ),
  );
  const discord = el('a', 'mn-onboarding-settings-link') as HTMLAnchorElement;
  discord.href = DISCORD_INVITE_URL;
  discord.target = '_blank';
  discord.rel = 'noopener noreferrer';
  discord.textContent = 'Discord';
  wip.appendChild(discord);
  wip.appendChild(document.createTextNode('. It genuinely helps.'));
  letter.appendChild(wip);

  letter.appendChild(el('p', undefined, 'Thanks for giving it a shot.'));
  voice.appendChild(letter);

  const sign = el('div', 'mn-onboarding-welcome__sign');
  sign.appendChild(el('span', 'mn-onboarding-welcome__sign-name', 'Dukkus'));
  sign.appendChild(el('span', 'mn-onboarding-welcome__sign-role', 'Creator of Minnow'));
  voice.appendChild(sign);

  return voice;
}

/** Setup preview: what the wizard covers and roughly how long it takes. */
function renderPlan(): HTMLElement {
  const plan = el('aside', 'mn-onboarding-welcome__plan');
  plan.appendChild(el('span', 'mn-onboarding-welcome__plan-label', 'What we’ll set up'));

  const steps = el('ol', 'mn-onboarding-welcome__steps');
  SETUP_PREVIEW.forEach((entry, index) => {
    const step = el('li', 'mn-onboarding-welcome__step');
    step.appendChild(
      el('span', 'mn-onboarding-welcome__step-num', String(index + 1)),
    );
    const copy = el('span', 'mn-onboarding-welcome__step-copy');
    copy.appendChild(el('span', 'mn-onboarding-welcome__step-name', entry.name));
    copy.appendChild(el('span', 'mn-onboarding-welcome__step-desc', entry.desc));
    step.appendChild(copy);
    steps.appendChild(step);
  });
  plan.appendChild(steps);

  plan.appendChild(
    el(
      'p',
      'mn-onboarding-welcome__plan-meta',
      'About 2 minutes. Skip anything and finish later.',
    ),
  );

  return plan;
}

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

    const welcome = el('div', 'mn-onboarding-welcome');
    const grid = el('div', 'mn-onboarding-welcome__grid');
    grid.appendChild(renderVoice());
    grid.appendChild(renderPlan());
    welcome.appendChild(grid);
    container.appendChild(welcome);

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
