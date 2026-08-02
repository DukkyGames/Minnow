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
  { name: 'Appearance', desc: 'Choose a theme that suits you.' },
  { name: 'Models', desc: 'Connect the models you’ll work with.' },
  { name: 'Permissions', desc: 'Decide what your agents can do on their own.' },
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
    el(
      'p',
      'mn-onboarding-welcome__tagline',
      'One workspace for the models you already run.',
    ),
  );
  brand.appendChild(wordmarkBlock);
  voice.appendChild(brand);

  const letter = el('div', 'mn-onboarding-welcome__letter');
  letter.appendChild(
    el(
      'p',
      'mn-onboarding-welcome__letter-lead',
      'Minnow is a workspace for all models. What started as a basic chat, has spiraled into a full-featured workspace for chat, code, research, and orchestration...',
    ),
  );
  letter.appendChild(
    el(
      'p',
      undefined,
      'It works with LM Studio, Ollama, or any endpoint you point it at. There’s no Minnow account, and nothing phones home. Your keys, chats, and files stay on your disk.',
    ),
  );
  letter.appendChild(
    el(
      'p',
      undefined,
      'It’s very much still a work in progress, so you will hit some rough edges, but it’s at a point where it feels like it could actually be useful.',
    ),
  );

  const wip = el('p');
  wip.appendChild(
    document.createTextNode(
      'When something breaks — or just feels wrong — say so on ',
    ),
  );
  const discord = el('a', 'mn-onboarding-settings-link') as HTMLAnchorElement;
  discord.href = DISCORD_INVITE_URL;
  discord.target = '_blank';
  discord.rel = 'noopener noreferrer';
  discord.textContent = 'Discord';
  wip.appendChild(discord);
  wip.appendChild(
    document.createTextNode(
      ' or open an issue on GitHub. Nothing helps more than that.',
    ),
  );
  letter.appendChild(wip);

  letter.appendChild(el('p', undefined, 'Thanks for being here this early.'));
  voice.appendChild(letter);

  const sign = el('div', 'mn-onboarding-welcome__sign');
  sign.appendChild(el('span', 'mn-onboarding-welcome__sign-name', 'Henri Grimm'));
  sign.appendChild(el('span', 'mn-onboarding-welcome__sign-role', 'Minnow Developer'));
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
      'About two minutes. Skip anything and come back to it later.',
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
