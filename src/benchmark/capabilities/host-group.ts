/**
 * Host band classification for capability matrix roster rows.
 */

export type CapabilityHostBand = 'cloud' | 'lm-studio' | 'minnow-hosting';

const MINNOW_HOSTING_PROVIDER_IDS = new Set([
  'minnow-library',
  'llama-cpp-local',
  'mlx-lm-local',
]);

/** Map a provider id to Cloud, LM Studio, or Minnow Hosting sheet band. */
export function classifyProviderHost(providerId: string): CapabilityHostBand {
  const id = providerId.trim().toLowerCase();
  if (MINNOW_HOSTING_PROVIDER_IDS.has(id)) return 'minnow-hosting';
  if (id === 'lm-studio' || id.startsWith('lm-studio')) return 'lm-studio';
  return 'cloud';
}

export const CAPABILITY_HOST_BAND_LABELS: Record<CapabilityHostBand, string> = {
  cloud: 'Cloud',
  'lm-studio': 'LM Studio',
  'minnow-hosting': 'Minnow Hosting',
};
