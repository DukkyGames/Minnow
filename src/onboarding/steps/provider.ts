/**
 * S2 — Provider path choice and branch screens (local / managed / cloud).
 */

import {
  createProvider,
  updateProvider,
  updateProviderSecrets,
  type CreateProviderPayload,
} from '../../providers/store';
import type { ProviderPublic } from '../../providers/types';
import { getDefaultPaths } from '../../providers/paths';
import { fetchModelsForProvider } from '../../providers/fetch-models';
import { createChoiceCard, createStatusPill, el, renderStepHeader } from '../ui-helpers';
import {
  firstReachableProbe,
  probeLocalProviders,
  type ProviderProbeResult,
} from '../provider-probe';
import type { ApiKind, AuthStyle } from '../../providers/types';
import type { OnboardingContext, OnboardingStep, OnboardingStepActions } from '../types';
import { recordStepProgress } from '../state-core';

let selectedPath: OnboardingContext['providerPath'] = null;
let probeResults: ProviderProbeResult[] = [];
let localProviderId = '';
let localBaseUrl = '';
let cloudPreset = 'openrouter';
let cloudBaseUrl = 'https://openrouter.ai/api';
let cloudApiKey = '';
let connectionStatus: 'idle' | 'ok' | 'err' = 'idle';
let connectionError = '';

interface CloudPreset {
  id: string;
  label: string;
  baseUrl: string;
  apiKind?: ApiKind;
  authStyle?: AuthStyle;
  /** Route Claude models to the messages path on mixed OpenAI gateways. */
  autoApi?: boolean;
}

/** Gateway origin only; `/v1/models` etc. come from getDefaultPaths(apiKind). */
const CLOUD_PRESETS: CloudPreset[] = [
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai' },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen',
    autoApi: true,
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go',
    autoApi: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKind: 'anthropic-v1',
    authStyle: 'x-api-key',
  },
  { id: 'custom', label: 'Custom', baseUrl: '' },
];

export const providerChoiceStep: OnboardingStep = {
  id: 'provider-choice',
  title: 'How will you run models?',
  canSkip: true,

  isApplicable() {
    return true;
  },

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step';
    selectedPath = ctx.providerPath;

    renderStepHeader(container, providerChoiceStep, actions.stepIndex, actions.totalSteps);
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
    renderStepHeader(container, providerLocalStep, actions.stepIndex, actions.totalSteps);
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

    if (!localBaseUrl) {
      localBaseUrl = hit?.baseUrl ?? 'http://localhost:1234';
    }

    const urlInput = el('input', 'mn-onboarding-field') as HTMLInputElement;
    urlInput.type = 'url';
    urlInput.placeholder = 'http://localhost:1234';
    urlInput.value = localBaseUrl;
    urlInput.autocomplete = 'off';
    urlInput.addEventListener('input', () => {
      localBaseUrl = urlInput.value.trim();
    });
    container.appendChild(urlInput);

    const testBtn = el('button', 'mn-onboarding-secondary-btn', 'Test connection');
    testBtn.type = 'button';
    testBtn.addEventListener('click', () => {
      localBaseUrl = urlInput.value.trim();
      void testLocalConnection(localBaseUrl, actions, container, ctx);
    });
    container.appendChild(testBtn);

    actions.setPrimaryLabel('Continue');
    actions.setPrimaryEnabled(connectionStatus === 'ok');

    if (hit && connectionStatus === 'idle') {
      void testLocalConnection(localBaseUrl, actions, container, ctx);
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

export { providerManagedStep } from './managed';

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

    renderStepHeader(container, providerCloudStep, actions.stepIndex, actions.totalSteps);
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
    urlInput.placeholder = 'https://api.example.com';
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
      void testCloudConnection(actions, container, ctx);
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

function rerenderLocal(
  container: HTMLElement,
  ctx: OnboardingContext,
  actions: OnboardingStepActions,
): void {
  providerLocalStep.render(container, ctx, actions);
}

function rerenderCloud(
  container: HTMLElement,
  ctx: OnboardingContext,
  actions: OnboardingStepActions,
): void {
  providerCloudStep.render(container, ctx, actions);
}

/** Create provider or update when npm start already seeded the same id. */
async function ensureOnboardingProvider(
  payload: CreateProviderPayload,
): Promise<{ ok: true; provider: ProviderPublic } | { ok: false; error: string }> {
  const created = await createProvider(payload);
  if (created.ok === false) {
    if (!created.error.includes('already exists')) {
      return created;
    }
    return updateProvider(payload.id, {
      label: payload.label,
      baseUrl: payload.baseUrl,
      apiKind: payload.apiKind,
      authStyle: payload.authStyle,
      enabled: payload.enabled,
      modelsPath: payload.modelsPath,
      chatCompletionsPath: payload.chatCompletionsPath,
      messagesPath: payload.messagesPath,
      autoApi: payload.autoApi,
    });
  }
  return created;
}

async function testLocalConnection(
  baseUrl: string,
  actions: OnboardingStepActions,
  container?: HTMLElement,
  ctx?: OnboardingContext,
): Promise<void> {
  connectionStatus = 'idle';
  connectionError = '';
  localBaseUrl = baseUrl;
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
  const result = await ensureOnboardingProvider({
    id: match.id,
    label: match.label,
    baseUrl,
    apiKind: match.apiKind,
    enabled: true,
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
  });

  if (result.ok === false) {
    connectionStatus = 'err';
    connectionError = result.error;
    actions.setPrimaryEnabled(false);
    if (container && ctx) rerenderLocal(container, ctx, actions);
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
  if (container && ctx) rerenderLocal(container, ctx, actions);
}

async function testCloudConnection(
  actions: OnboardingStepActions,
  container?: HTMLElement,
  ctx?: OnboardingContext,
): Promise<void> {
  if (!cloudBaseUrl || !cloudApiKey) {
    connectionStatus = 'err';
    connectionError = 'Base URL and API key required';
    actions.setPrimaryEnabled(false);
    if (container && ctx) rerenderCloud(container, ctx, actions);
    return;
  }

  const preset = CLOUD_PRESETS.find((p) => p.id === cloudPreset);
  const apiKind = preset?.apiKind ?? 'openai-v1';
  const paths = getDefaultPaths(apiKind);
  const id = `onboarding-cloud-${cloudPreset}`;
  const result = await ensureOnboardingProvider({
    id,
    label: preset?.label ?? 'Cloud',
    baseUrl: cloudBaseUrl,
    apiKind,
    authStyle: preset?.authStyle ?? 'bearer',
    autoApi: preset?.autoApi,
    enabled: true,
    modelsPath: paths.modelsPath,
    chatCompletionsPath: paths.chatCompletionsPath,
    messagesPath: paths.messagesPath,
  });

  if (result.ok === false) {
    connectionStatus = 'err';
    connectionError = result.error;
    actions.setPrimaryEnabled(false);
    if (container && ctx) rerenderCloud(container, ctx, actions);
    return;
  }

  const keyRes = await updateProviderSecrets(id, { apiKey: cloudApiKey });
  if (keyRes.ok === false) {
    connectionStatus = 'err';
    connectionError = keyRes.error;
    actions.setPrimaryEnabled(false);
    if (container && ctx) rerenderCloud(container, ctx, actions);
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
  if (container && ctx) rerenderCloud(container, ctx, actions);
}

/** Warm probe cache before provider-choice renders. */
export async function warmProviderProbes(): Promise<void> {
  probeResults = await probeLocalProviders();
}
