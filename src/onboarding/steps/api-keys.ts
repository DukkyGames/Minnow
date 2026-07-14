/**
 * S9 — Search API keys when private SearXNG was skipped.
 */

import { loadSearchConfig, saveSearchConfig } from '../../config/search-config';
import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

let braveKey = '';
let tavilyKey = '';
let provider: 'tavily' | 'brave' | 'duckduckgo' = 'tavily';
let saved = false;

export const apiKeysStep: OnboardingStep = {
  id: 'api-keys',
  title: 'Search API keys',
  canSkip: true,
  isApplicable: (ctx) => ctx.searxngSkipped,

  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    renderStepHeader(container, apiKeysStep, actions.stepIndex, actions.totalSteps);

    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'You skipped local SearXNG. Add a hosted search key or use DuckDuckGo without a key.',
      ),
    );

    const chipRow = el('div', 'mn-onboarding-chip-row');
    (
      [
        ['tavily', 'Tavily'],
        ['brave', 'Brave'],
        ['duckduckgo', 'DuckDuckGo'],
      ] as const
    ).forEach(([id, label]) => {
      const chip = el('button', 'mn-onboarding-wallpaper-chip', label);
      chip.type = 'button';
      if (provider === id) chip.classList.add('is-selected');
      chip.addEventListener('click', () => {
        provider = id;
        apiKeysStep.render(container, _ctx, actions);
      });
      chipRow.appendChild(chip);
    });
    container.appendChild(chipRow);

    const keysWrap = el('div', 'mn-onboarding-form-grid');
    if (provider === 'tavily') {
      const wrap = el('label', 'mn-onboarding-field-label');
      wrap.appendChild(el('span', null, 'Tavily API key'));
      const input = el('input', 'mn-onboarding-field') as HTMLInputElement;
      input.type = 'password';
      input.value = tavilyKey;
      input.autocomplete = 'off';
      input.addEventListener('input', () => {
        tavilyKey = input.value.trim();
        actions.setPrimaryEnabled(tavilyKey.length > 0);
      });
      wrap.appendChild(input);
      keysWrap.appendChild(wrap);
    } else if (provider === 'brave') {
      const wrap = el('label', 'mn-onboarding-field-label');
      wrap.appendChild(el('span', null, 'Brave Search API key'));
      const input = el('input', 'mn-onboarding-field') as HTMLInputElement;
      input.type = 'password';
      input.value = braveKey;
      input.autocomplete = 'off';
      input.addEventListener('input', () => {
        braveKey = input.value.trim();
        actions.setPrimaryEnabled(braveKey.length > 0);
      });
      wrap.appendChild(input);
      keysWrap.appendChild(wrap);
    } else {
      keysWrap.appendChild(
        el('p', 'mn-onboarding-muted', 'DuckDuckGo needs no API key. Rate limits apply.'),
      );
    }
    container.appendChild(keysWrap);

    void loadSearchConfig().then((config) => {
      braveKey = config.keys.braveApiKey;
      tavilyKey = config.keys.tavilyApiKey;
    });

    actions.setPrimaryLabel(provider === 'duckduckgo' ? 'Continue' : 'Save and continue');
    actions.setPrimaryEnabled(provider === 'duckduckgo' || Boolean(tavilyKey || braveKey));
  },

  async commit(ctx) {
    const config = await loadSearchConfig();
    await saveSearchConfig({
      ...config,
      provider,
      keys: {
        braveApiKey: braveKey,
        tavilyApiKey: tavilyKey,
      },
    });
    saved = true;
    ctx.state = recordStepProgress(ctx.state, 'api-keys', {
      done: true,
      data: { provider },
    });
  },
};

export function resetApiKeysStepState(): void {
  braveKey = '';
  tavilyKey = '';
  provider = 'tavily';
  saved = false;
}
