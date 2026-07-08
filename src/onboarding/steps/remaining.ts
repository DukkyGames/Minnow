/**
 * S5, S6, S10, S12 and placeholder steps for integrations not yet wired.
 */

import { setAllBuiltInToolPermissions } from '../../tools/config';
import { el, createChoiceCard } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

let permissionPreset: 'full' | 'ask' | 'minimal' = 'full';

export const permissionsStep: OnboardingStep = {
  id: 'permissions',
  title: 'Tool permissions',
  canSkip: true,
  isApplicable: () => true,
  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    container.appendChild(el('h2', 'mn-onboarding-step-title', 'Tool permissions'));
    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Controls how tools run during chat. Destructive actions still ask in the thread.',
      ),
    );

    const grid = el('div', 'mn-onboarding-choice-grid');
    const presets: { id: typeof permissionPreset; title: string; desc: string; rec?: boolean }[] = [
      {
        id: 'full',
        title: 'Full access',
        desc: 'All tools run locally with chat confirmations for risky operations.',
        rec: true,
      },
      { id: 'ask', title: 'Ask first', desc: 'Prompt before every tool call.' },
      { id: 'minimal', title: 'Minimal', desc: 'Read-only tools enabled; writes disabled.' },
    ];

    presets.forEach((preset) => {
      grid.appendChild(
        createChoiceCard({
          title: preset.title,
          description: preset.desc,
          recommended: preset.rec,
          selected: permissionPreset === preset.id,
          onSelect: () => {
            permissionPreset = preset.id;
            actions.setPrimaryEnabled(true);
            providerPermissionsRerender(grid, presets);
          },
        }),
      );
    });
    container.appendChild(grid);
    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(true);
  },
  async commit(ctx) {
    if (permissionPreset === 'full') await setAllBuiltInToolPermissions('full');
    else if (permissionPreset === 'ask') await setAllBuiltInToolPermissions('ask');
    else await setAllBuiltInToolPermissions('off');
    ctx.state = recordStepProgress(ctx.state, 'permissions', {
      done: true,
      data: { preset: permissionPreset },
    });
  },
};

function providerPermissionsRerender(
  grid: HTMLElement,
  presets: { id: typeof permissionPreset }[],
): void {
  grid.querySelectorAll('.mn-onboarding-choice').forEach((node, i) => {
    (node as HTMLElement).classList.toggle('is-selected', presets[i]?.id === permissionPreset);
  });
}

export const memoryStep: OnboardingStep = {
  id: 'memory',
  title: 'Memory and Brain',
  canSkip: true,
  isApplicable: () => true,
  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    container.appendChild(el('h2', 'mn-onboarding-step-title', 'Memory and Brain'));
    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Minnow remembers facts locally under ~/.minnow and files them into your Brain wiki. Both stay on by default.',
      ),
    );

    const card = el('div', 'mn-onboarding-info-card');
    card.appendChild(el('p', null, 'Semantic recall improves answers across chats.'));
    card.appendChild(el('p', null, 'View and edit memories anytime in the Brain app.'));
    container.appendChild(card);

    if (!ctx.configServerAvailable) {
      container.appendChild(
        el('p', 'mn-onboarding-notice', 'Full memory features need npm start.'),
      );
    }

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(true);
  },
  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'memory', { done: true, data: { enabled: true } });
  },
};

const EXPLAINER_PANELS = [
  {
    title: 'Brain',
    body: 'Your local wiki and memory graph. Minnow reads it before answering and files new facts into it.',
  },
  {
    title: 'Deep Research',
    body: 'A sub-agent searches the web, reads sources, and writes a cited synthesis.',
  },
  {
    title: 'Experts',
    body: 'Purpose-built agent personas you compose, run, and evaluate.',
  },
  {
    title: 'Code',
    body: 'A real workspace: files, git, terminal, dev server, and editor.',
  },
  {
    title: 'Email',
    body: 'Read-only inbox sync with AI triage. Nothing sends without you clicking send.',
  },
  {
    title: 'Tools and /commands',
    body: 'Tool calls appear inline in chat. Slash commands load skills on demand.',
  },
];

let explainerIndex = 0;

export const explainerStep: OnboardingStep = {
  id: 'explainer',
  title: 'How Minnow works',
  canSkip: true,
  isApplicable: () => true,
  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--explainer';
    const panel = EXPLAINER_PANELS[explainerIndex] ?? EXPLAINER_PANELS[0];

    container.appendChild(el('h2', 'mn-onboarding-step-title', panel.title));
    container.appendChild(el('p', 'mn-onboarding-explainer-body', panel.body));

    const dots = el('div', 'mn-onboarding-explainer-dots');
    EXPLAINER_PANELS.forEach((_, i) => {
      const dot = el('button', 'mn-onboarding-explainer-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Panel ${i + 1}`);
      if (i === explainerIndex) dot.classList.add('is-active');
      dot.addEventListener('click', () => {
        explainerIndex = i;
        explainerStep.render(container, _ctx, actions);
      });
      dots.appendChild(dot);
    });
    container.appendChild(dots);

    actions.setPrimaryLabel(
      explainerIndex >= EXPLAINER_PANELS.length - 1 ? 'Continue' : 'Next panel',
    );
    actions.setPrimaryEnabled(true);
  },
  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'explainer', { done: true });
    explainerIndex = 0;
  },
};

/** Advance explainer panels without leaving the step. Returns true when advanced. */
export function advanceExplainerPanel(): boolean {
  if (explainerIndex >= EXPLAINER_PANELS.length - 1) return false;
  explainerIndex += 1;
  return true;
}

function makePlaceholderStep(
  id: OnboardingStep['id'],
  title: string,
  message: string,
): OnboardingStep {
  return {
    id,
    title,
    canSkip: true,
    isApplicable(ctx) {
      if (id === 'api-keys') return ctx.searxngSkipped;
      if (id === 'demo-chat') return Boolean(ctx.providerId && ctx.modelId);
      return true;
    },
    render(container, _ctx, actions) {
      container.innerHTML = '';
      container.className = 'mn-onboarding-step';
      container.appendChild(el('h2', 'mn-onboarding-step-title', title));
      container.appendChild(el('p', 'mn-onboarding-step-desc', message));
      container.appendChild(
        el('p', 'mn-onboarding-muted', 'Set up later in Settings, or skip this step now.'),
      );
      actions.setPrimaryLabel('Continue');
      actions.setPrimaryEnabled(true);
    },
    commit(ctx) {
      ctx.state = recordStepProgress(ctx.state, id, { skipped: true });
    },
  };
}

export const extrasStep = makePlaceholderStep(
  'extras',
  'Install extras',
  'SearXNG, embeddings, voice, and llama.cpp runtime installs ship in the next phase.',
);

export const emailStep = makePlaceholderStep(
  'email',
  'Email',
  'Connect IMAP in Settings when you are ready.',
);

export const calendarStep = makePlaceholderStep(
  'calendar',
  'Calendar',
  'CalDAV and local calendar live in Settings.',
);

export const apiKeysStep = makePlaceholderStep(
  'api-keys',
  'Search API keys',
  'Add Tavily or Brave keys if you skipped private web search.',
);

export const demoChatStep = makePlaceholderStep(
  'demo-chat',
  'Demo chat',
  'A guided chat that seeds your Brain arrives in Phase 4. Skip for now.',
);

export const doneStep: OnboardingStep = {
  id: 'done',
  title: 'Done',
  canSkip: false,
  isApplicable: () => true,
  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--done';

    container.appendChild(el('h2', 'mn-onboarding-step-title', 'You are set up'));
    container.appendChild(
      el('p', 'mn-onboarding-step-desc', 'Minnow is ready. Open the desktop to start chatting.'),
    );

    const checklist = el('ul', 'mn-onboarding-checklist');
    const rows: [string, boolean][] = [
      ['Theme', Boolean(ctx.state.steps.theme?.done)],
      ['Provider', Boolean(ctx.state.steps['provider-local']?.done || ctx.state.steps['provider-cloud']?.done)],
      ['Model', Boolean(ctx.state.steps['model-pick']?.done)],
      ['Tool permissions', Boolean(ctx.state.steps.permissions?.done)],
      ['Memory and Brain', Boolean(ctx.state.steps.memory?.done)],
    ];
    rows.forEach(([label, ok]) => {
      const li = el('li', 'mn-onboarding-checklist__row');
      li.appendChild(el('span', ok ? 'is-ok' : 'is-muted', ok ? '✓' : '–'));
      li.appendChild(el('span', null, label));
      checklist.appendChild(li);
    });
    container.appendChild(checklist);

    actions.setPrimaryLabel('Open Minnow');
    actions.setPrimaryEnabled(true);
  },
  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'done', { done: true });
  },
};