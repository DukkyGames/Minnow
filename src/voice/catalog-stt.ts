/**
 * Static STT model catalog for Models → Voice (Phase 1 stubs).
 */

import type { VoiceSttLocalConfig } from '../config/voice-meta';

export interface SttCatalogEntry {
  modelId: string;
  label: string;
  params: string;
  estVramGb: number;
  cpuOk: boolean;
  capabilities: {
    longForm: boolean;
    timestamps: boolean;
    translate: boolean;
    flashAttention: boolean;
  };
  recommendedDefaults: Partial<VoiceSttLocalConfig>;
}

/** Bundled Whisper STT catalog entries (fit badges use estVramGb + cpuOk). */
export const STT_CATALOG: SttCatalogEntry[] = [
  {
    modelId: 'openai/whisper-tiny',
    label: 'Whisper Tiny',
    params: '39M',
    estVramGb: 1,
    cpuOk: true,
    capabilities: {
      longForm: true,
      timestamps: true,
      translate: true,
      flashAttention: false,
    },
    recommendedDefaults: {
      modelId: 'openai/whisper-tiny',
      batchSize: 1,
      chunkLengthSeconds: 30,
    },
  },
  {
    modelId: 'openai/whisper-base',
    label: 'Whisper Base',
    params: '74M',
    estVramGb: 1,
    cpuOk: true,
    capabilities: {
      longForm: true,
      timestamps: true,
      translate: true,
      flashAttention: false,
    },
    recommendedDefaults: {
      modelId: 'openai/whisper-base',
      batchSize: 1,
      chunkLengthSeconds: 30,
    },
  },
  {
    modelId: 'openai/whisper-small',
    label: 'Whisper Small',
    params: '244M',
    estVramGb: 2,
    cpuOk: true,
    capabilities: {
      longForm: true,
      timestamps: true,
      translate: true,
      flashAttention: false,
    },
    recommendedDefaults: {
      modelId: 'openai/whisper-small',
      batchSize: 4,
      chunkLengthSeconds: 30,
    },
  },
  {
    modelId: 'openai/whisper-medium',
    label: 'Whisper Medium',
    params: '769M',
    estVramGb: 5,
    cpuOk: false,
    capabilities: {
      longForm: true,
      timestamps: true,
      translate: true,
      flashAttention: true,
    },
    recommendedDefaults: {
      modelId: 'openai/whisper-medium',
      batchSize: 4,
      computeType: 'float16',
      attnImplementation: 'sdpa',
    },
  },
  {
    modelId: 'openai/whisper-large-v3',
    label: 'Whisper Large v3',
    params: '1.5B',
    estVramGb: 6,
    cpuOk: false,
    capabilities: {
      longForm: true,
      timestamps: true,
      translate: true,
      flashAttention: true,
    },
    recommendedDefaults: {
      modelId: 'openai/whisper-large-v3',
      batchSize: 8,
      chunkLengthSeconds: 30,
      computeType: 'float16',
      attnImplementation: 'flash_attention_2',
    },
  },
];

export function findSttCatalogEntry(modelId: string): SttCatalogEntry | undefined {
  return STT_CATALOG.find((entry) => entry.modelId === modelId);
}
