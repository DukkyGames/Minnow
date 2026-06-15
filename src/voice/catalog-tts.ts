/**
 * Static TTS model catalog for Models → Voice (Phase 1 stubs).
 */

import type {
  VoiceTtsGenerationConfig,
  VoiceTtsLocalRuntimeConfig,
} from '../config/voice-meta';

export type TtsCatalogMode = 'custom_voice' | 'voice_design' | 'voice_clone' | 'tokenizer';

export interface TtsCatalogEntry {
  modelId: string;
  label: string;
  mode: TtsCatalogMode;
  params: string;
  estVramGb: number;
  streaming: boolean;
  instructControl: boolean;
  requiresTokenizer: boolean;
  speakers?: string[];
  capabilities: {
    streaming: boolean;
    instructControl: boolean;
    voiceClone: boolean;
    voiceDesign: boolean;
  };
  recommendedDefaults: Partial<
    VoiceTtsLocalRuntimeConfig & { generation: Partial<VoiceTtsGenerationConfig> }
  >;
}

const CUSTOM_VOICE_SPEAKERS = [
  'Vivian',
  'Serena',
  'Uncle_Fu',
  'Dylan',
  'Eric',
  'Ryan',
  'Aiden',
  'Ono_Anna',
  'Sohee',
];

/** Bundled Qwen3-TTS catalog entries. */
export const TTS_CATALOG: TtsCatalogEntry[] = [
  {
    modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    label: 'Qwen3-TTS 0.6B CustomVoice',
    mode: 'custom_voice',
    params: '0.6B',
    estVramGb: 3,
    streaming: true,
    instructControl: false,
    requiresTokenizer: true,
    speakers: CUSTOM_VOICE_SPEAKERS,
    capabilities: {
      streaming: true,
      instructControl: false,
      voiceClone: false,
      voiceDesign: false,
    },
    recommendedDefaults: {
      modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      dtype: 'bfloat16',
    },
  },
  {
    modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    label: 'Qwen3-TTS 1.7B CustomVoice',
    mode: 'custom_voice',
    params: '1.7B',
    estVramGb: 5,
    streaming: true,
    instructControl: true,
    requiresTokenizer: true,
    speakers: CUSTOM_VOICE_SPEAKERS,
    capabilities: {
      streaming: true,
      instructControl: true,
      voiceClone: false,
      voiceDesign: false,
    },
    recommendedDefaults: {
      modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
      dtype: 'bfloat16',
      attnImplementation: 'flash_attention_2',
    },
  },
  {
    modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    label: 'Qwen3-TTS 1.7B VoiceDesign',
    mode: 'voice_design',
    params: '1.7B',
    estVramGb: 5,
    streaming: true,
    instructControl: true,
    requiresTokenizer: true,
    capabilities: {
      streaming: true,
      instructControl: true,
      voiceClone: false,
      voiceDesign: true,
    },
    recommendedDefaults: {
      modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
      dtype: 'bfloat16',
    },
  },
  {
    modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    label: 'Qwen3-TTS 0.6B Base (clone)',
    mode: 'voice_clone',
    params: '0.6B',
    estVramGb: 3,
    streaming: true,
    instructControl: false,
    requiresTokenizer: true,
    capabilities: {
      streaming: true,
      instructControl: false,
      voiceClone: true,
      voiceDesign: false,
    },
    recommendedDefaults: {
      modelId: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
      dtype: 'bfloat16',
    },
  },
  {
    modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
    label: 'Qwen3-TTS 1.7B Base (clone)',
    mode: 'voice_clone',
    params: '1.7B',
    estVramGb: 5,
    streaming: true,
    instructControl: false,
    requiresTokenizer: true,
    capabilities: {
      streaming: true,
      instructControl: false,
      voiceClone: true,
      voiceDesign: false,
    },
    recommendedDefaults: {
      modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
      dtype: 'bfloat16',
    },
  },
  {
    modelId: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
    label: 'Qwen3-TTS Tokenizer 12Hz',
    mode: 'tokenizer',
    params: '—',
    estVramGb: 0,
    streaming: false,
    instructControl: false,
    requiresTokenizer: false,
    capabilities: {
      streaming: false,
      instructControl: false,
      voiceClone: false,
      voiceDesign: false,
    },
    recommendedDefaults: {
      modelId: 'Qwen/Qwen3-TTS-Tokenizer-12Hz',
    },
  },
];

export function findTtsCatalogEntry(modelId: string): TtsCatalogEntry | undefined {
  return TTS_CATALOG.find((entry) => entry.modelId === modelId);
}
