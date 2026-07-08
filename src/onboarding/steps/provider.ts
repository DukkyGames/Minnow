/**
 * S2 — Provider path choice and branch screens (local / managed / cloud).
 */

import { createProvider, updateProviderSecrets } from '../../providers/store';
import { getDefaultPaths } from '../../providers/paths';
import { fetchModelsForProvider } from '../../providers/fetch-models';
import { createChoiceCard, createStatusPill, el } from '../ui-helpers';
import {
  firstReachableProbe,
  probeLocalProviders,
  type ProviderProbeResult,
} from '../provider-probe';
import type { OnboardingContext, OnboardingStep, OnboardingStepActions } from '../types';
import { recordStepProgress } from '../state-core';

let selectedPath: OnboardingContext['providerPath'] = null;
let probeResults: ProviderProbeResult[] = [];
let localProviderId = '';
let cloudPreset = 'openrouter';
let cloudBaseUrl = 'https://openrouter.ai/api/v1';
let cloudApiKey = '';
let connectionStatus: 'idle' | 'ok' | 'err' = 'idle';
let connectionError = '';

const CLOUD_PRESETS: { id: string; label: string; baseUrl: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'custom', label: 'Custom', baseUrl: '' },
];

export const providerChoiceStep: OnboardingStep = {
  id: 'provider-choice',
  title: 'Models',
  canSkip: true,

  isApplicable() {
    return true;
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    selectedPath = ctx.providerPath;

    container.appendChild(el('h2', 'mn-onboarding-step-title', 'How will you run models?'));
    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Pick one path. You can add more providers later in Settings.',
      ),
    );

    const grid = el('div', 'mn-onboarding-choice-grid');
    const detected = probeResults.find((p) => p.reachable);
    const detectBadge = detected ? `${detected.label} detected` : undefined;

    grid.appendChild(
      createChoiceCard({
        title: 'I already run a local server',
        description: 'LM Studio, Ollama, or llama.cpp on this machine.',
        badge: detectBadge,
        selected: selectedPath === 'local',
        onSelect: () => {
          selectedPath = 'local';
          actions.patchContext({ providerPath: 'local' });
          actions.next();
        },
      }),
    );

    grid.appendChild(
      createChoiceCard({
        title: 'Let Minnow run models for me',
        description: 'Hardware-aware download and serve (requires npm start).',
        recommended: !ctx.serverAvailable,
        selected: selectedPath === 'managed',
        onSelect: () => {
          selectedPath = 'managed';
          actions.patchContext({ providerPath: 'managed' });
          actions.next();
        },
      }),
    );

    grid.appendChild(
      createChoiceCard({
        title: 'Use a cloud API',
        description: 'OpenAI-compatible hosted models with an API key.',
        selected: selectedPath === 'cloud',
        onSelect: () => {
          selectedPath = 'cloud';
          actions.patchContext({ providerPath: 'cloud' });
          actions.next();
        },
      }),
    );

    container.appendChild(grid);
    actions.setPrimaryEnabled(false);
    actions.setPrimaryLabel('Continue');
  },

  async commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'provider-choice', {
      done: Boolean(selectedPath),
      data: { path: selectedPath },
    });
  },
};

export const providerLocalStep: OnboardingStep = {
  id: 'provider-local',
  title: 'Local server',
  canSkip: true,

  isApplicable(ctx) {
    return ctx.providerPath === 'local';
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';

    const hit = firstReachableProbe(probeResults);
    container.appendChild(el('h2', 'mn-onboarding-step-title', 'Connect your local server'));
    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        hit
          ? `We found ${hit.label} at ${hit.baseUrl}. Confirm to register it.`
          : 'No server detected on common ports. Enter your base URL below.',
      ),
    );

    const statusRow = el('div', 'mn-onboarding-status-row');
    const status = createStatusPill(
      connectionStatus === 'ok' ? 'ok' : connectionStatus === 'err' ? 'err' : 'pending',
      connectionStatus === 'ok'
        ? 'Reachable'
        : connectionStatus === 'err'
          ? connectionError || 'Unreachable'
          : 'Not tested',
    );
    statusRow.appendChild(status);
    container.appendChild(statusRow);

    const urlInput = el('input', 'mn-onboarding-field') as HTMLInputElement;
    urlInput.type = 'url';
    urlInput.placeholder = 'http://localhost:1234';
    urlInput.value = hit?.baseUrl ?? 'http://localhost:1234';
    urlInput.autocomplete = 'off';
    container.appendChild(urlInput);

    const testBtn = el('button', 'mn-onboarding-secondary-btn', 'Test connection');
    testBtn.type = 'button';
    testBtn.addEventListener('click', () => {
      void testLocalConnection(urlInput.value.trim(), actions);
    });
    container.appendChild(testBtn);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(connectionStatus === 'ok');

    if (hit && connectionStatus === 'idle') {
      void testLocalConnection(hit.baseUrl, actions);
    }
  },

  async commit(ctx) {
    if (!localProviderId) return;
    ctx.state = recordStepProgress(ctx.state, 'provider-local', {
      done: true,
      data: { path: 'local', providerId: localProviderId },
    });
    ctx.providerId = localProviderId;
  },
};

export const providerManagedStep: OnboardingStep = {
  id: 'provider-managed',
  title: 'Managed models',
  canSkip: true,

  isApplicable(ctx) {
    return ctx.providerPath === 'managed';
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';

    container.appendChild(el('h2', 'mn-onboarding-step-title', 'Minnow-managed models'));
    if (!ctx.serverAvailable) {
      container.appendChild(
        el(
          'p',
          'mn-onboarding-notice',
          'Local installs need npm start. You can finish theme and permissions now, then run setup again later.',
        ),
      );
      actions.setPrimaryEnabled(true);
      actions.setPrimaryLabel('Continue');
      return;
    }

    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Open the Models app to download and serve a GGUF. We will pick your default model on the next screen.',
      ),
    );

    const openBtn = el('button', 'mn-onboarding-secondary-btn', 'Open Models app');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => {
      void import('../../os/app-host').then((m) => m.launchApp('models'));
    });
    container.appendChild(openBtn);

    actions.setPrimaryEnabled(true);
    actions.setPrimaryLabel('Continue');
  },

  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'provider-managed', {
      done: true,
      skipped: !ctx.serverAvailable,
      data: { path: 'managed' },
    });
  },
};

export const providerCloudStep: OnboardingStep = {
  id: 'provider-cloud',
  title: 'Cloud API',
  canSkip: true,

  isApplicable(ctx) {
    return ctx.providerPath === 'cloud';
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';

    container.appendChild(el('h2', 'mn-onboarding-step-title', 'Cloud provider'));
    container.appendChild(
      el('p', 'mn-onboarding-step-desc', 'Keys are stored encrypted on this machine only.'),
    );

    const presetRow = el('div', 'mn-onboarding-chip-row');
    CLOUD_PRESETS.forEach((preset) => {
      const chip = el('button', 'mn-onboarding-wallpaper-chip', preset.label);
      chip.type = 'button';
      if (preset.id === cloudPreset) chip.classList.add('is-selected');
      chip.addEventListener('click', () => {
        cloudPreset = preset.id;
        if (preset.baseUrl) cloudBaseUrl = preset.baseUrl;
        actions.setPrimaryEnabled(false);
        connectionStatus = 'idle';
        rerenderCloud(container, ctx, actions);
      });
      presetRow.appendChild(chip);
    });
    container.appendChild(presetRow);

    const urlInput = el('input', 'mn-onboarding-field') as HTMLInputElement;
    urlInput.type = 'url';
    urlInput.placeholder = 'https://api.example.com/v1';
    urlInput.value = cloudBaseUrl;
    urlInput.disabled = cloudPreset !== 'custom';
    container.appendChild(urlInput);

    const keyInput = el('input', 'mn-onboarding-field') as HTMLInputElement;
    keyInput.type = 'password';
    keyInput.placeholder = 'API key';
    keyInput.autocomplete = 'off';
    container.appendChild(keyInput);

    const testBtn = el('button', 'mn-onboarding-secondary-btn', 'Test and save');
    testBtn.type = 'button';
    testBtn.addEventListener('click', () => {
      cloudBaseUrl = urlInput.value.trim();
      cloudApiKey = keyInput.value.trim();
      void testCloudConnection(actions);
    });
    container.appendChild(testBtn);

    const statusRow = el('div', 'mn-onboarding-status-row');
    statusRow.appendChild(
      createStatusPill(
        connectionStatus === 'ok' ? 'ok' : connectionStatus === 'err' ? 'err' : 'pending',
        connectionStatus === 'ok'
          ? 'Connected'
          : connectionStatus === 'err'
            ? connectionError
            : 'Not tested',
      ),
    );
    container.appendChild(statusRow);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(connectionStatus === 'ok');
  },

  async commit(ctx) {
    if (!localProviderId) return;
    ctx.state = recordStepProgress(ctx.state, 'provider-cloud', {
      done: true,
      data: { path: 'cloud', providerId: localProviderId },
    });
    ctx.providerId = localProviderId;
  },
};

function rerenderCloud(
  container: HTMLElement,
  ctx: OnboardingContext,
  actions: OnboardingStepActions,
): void {
  providerCloudStep.render(container, ctx, actions);
}

async function testLocalConnection(baseUrl: string, actions: OnboardingStepActions): Promise<void> {
  connectionStatus = 'idle';
  connectionError = '';
  actions.setPrimaryEnabled(false);
  const match =
    probeResults.find((p) => p.baseUrl === baseUrl) ??
    ({
      id: `onboarding-local-${Date.now()}`,
      label: 'Local server',
      baseUrl,
      apiKind: baseUrl.includes('1234') ? 'lm-studio-v0' : 'openai-v1',
      reachable: false,
    } as ProviderProbeResult);

  const paths = getDefaultPaths(match.apiKind);
  const result = await createProvider({
    id: match.id,
    label: match.label,
    baseUrl,
    apiKind: match.apiKind,
    enabled: true,
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
  });

  if (!result.ok) {
    connectionStatus = 'err';
    connectionError = result.error;
    actions.setPrimaryEnabled(false);
    return;
  }

  try {
    await fetchModelsForProvider(result.provider, new AbortController().signal);
    connectionStatus = 'ok';
    localProviderId = result.provider.id;
    actions.setPrimaryEnabled(true);
  } catch (err) {
    connectionStatus = 'err';
    connectionError = err instanceof Error ? err.message : 'Could not list models';
    actions.setPrimaryEnabled(false);
  }
}

async function testCloudConnection(actions: OnboardingStepActions): Promise<void> {
  if (!cloudBaseUrl || !cloudApiKey) {
    connectionStatus = 'err';
    connectionError = 'Base URL and API key required';
    actions.setPrimaryEnabled(false);
    return;
  }

  const id = `onboarding-cloud-${cloudPreset}`;
  const paths = getDefaultPaths('openai-v1');
  const result = await createProvider({
    id,
    label: CLOUD_PRESETS.find((p) => p.id === cloudPreset)?.label ?? 'Cloud',
    baseUrl: cloudBaseUrl,
    apiKind: 'openai-v1',
    authStyle: 'bearer',
    enabled: true,
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
  });

  if (!result.ok) {
    connectionStatus = 'err';
    connectionError = result.error;
    actions.setPrimaryEnabled(false);
    return;
  }

  const keyRes = await updateProviderSecrets(id, { apiKey: cloudApiKey });
  if (!keyRes.ok) {
    connectionStatus = 'err';
    connectionError = keyRes.error;
    actions.setPrimaryEnabled(false);
    return;
  }

  try {
    await fetchModelsForProvider(result.provider, new AbortController().signal);
    connectionStatus = 'ok';
    localProviderId = id;
    actions.setPrimaryEnabled(true);
  } catch (err) {
    connectionStatus = 'err';
    connectionError = err instanceof Error ? err.message : 'Connection failed';
    actions.setPrimaryEnabled(false);
  }
}

/** Warm probe cache before provider-choice renders. */
export async function warmProviderProbes(): Promise<void> {
  probeResults = await probeLocalProviders();
}
