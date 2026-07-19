/**
 * One-click cloud provider presets for onboarding and Settings → Providers.
 * Base URLs are gateway origins only — `/v1/models` etc. come from getDefaultPaths(apiKind).
 */

import type { ApiKind, AuthStyle } from './types';

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  apiKind?: ApiKind;
  authStyle?: AuthStyle;
  /** Route Claude models to the messages path on mixed OpenAI gateways. */
  autoApi?: boolean;
  /** Short credential hint shown in onboarding and Settings. */
  authHint?: string;
}

/** Shared catalog — keep in sync with tests under test/providers/presets.test.mjs */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai' },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen',
    autoApi: true,
    authHint: 'OpenCode Zen API key (Bearer).',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go',
    autoApi: true,
    authHint: 'OpenCode Go API key (Bearer).',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKind: 'anthropic-v1',
    authStyle: 'x-api-key',
    authHint: 'Anthropic API key (console.anthropic.com).',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    authHint: 'DeepSeek API key (platform.deepseek.com).',
  },
  {
    id: 'github-copilot',
    label: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com',
    autoApi: true,
    authHint:
      'GitHub Copilot OAuth Bearer token. Business: https://api.business.githubcopilot.com · Enterprise: https://api.enterprise.githubcopilot.com',
  },
];

/** Onboarding cloud step adds a manual "Custom" chip with no preset base URL. */
export const ONBOARDING_CLOUD_PRESETS: ProviderPreset[] = [
  ...PROVIDER_PRESETS,
  { id: 'custom', label: 'Custom', baseUrl: '' },
];

/** MIN-418 featured presets — browsable first in Settings → Providers. */
export const SETTINGS_FEATURED_PRESET_IDS: string[] = [
  'opencode-go',
  'opencode-zen',
  'anthropic',
  'deepseek',
  'github-copilot',
];

/** Local server quick-add entries for Settings → Providers picker. */
export const SETTINGS_LOCAL_PRESETS: ProviderPreset[] = [
  {
    id: 'lm-studio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    apiKind: 'lm-studio-v0',
    authHint: 'LM Studio local server (default port 1234).',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    apiKind: 'openai-v1',
    authHint: 'Ollama OpenAI-compatible API (default port 11434).',
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/** Local server quick-add entries for Settings → Providers picker. */
export function listSettingsLocalPresets(): ProviderPreset[] {
  return [...SETTINGS_LOCAL_PRESETS];
}

/** Featured cloud presets for the Settings picker grid. */
export function listSettingsFeaturedPresets(): ProviderPreset[] {
  return SETTINGS_FEATURED_PRESET_IDS.map((id) => getProviderPreset(id)).filter(
    (preset): preset is ProviderPreset => preset !== undefined,
  );
}

/** Remaining cloud presets after featured entries. */
export function listSettingsMorePresets(): ProviderPreset[] {
  const featuredIds = new Set(SETTINGS_FEATURED_PRESET_IDS);
  return PROVIDER_PRESETS.filter((preset) => !featuredIds.has(preset.id));
}

/** Presets for Settings quick-add, featured entries first then the rest. */
export function listSettingsProviderPresets(): ProviderPreset[] {
  return [...listSettingsFeaturedPresets(), ...listSettingsMorePresets()];
}
