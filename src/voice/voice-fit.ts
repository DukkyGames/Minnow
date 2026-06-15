/**
 * Hardware fit badges for Models → Voice catalog entries.
 */

import type { HardwareSnapshot } from '../models/types';
import type { SttCatalogEntry } from './catalog-stt';
import type { TtsCatalogEntry } from './catalog-tts';

export type VoiceFitLevel = 'perfect' | 'good' | 'marginal' | 'too_tight';

export interface VoiceFitResult {
  fitLevel: VoiceFitLevel;
  label: string;
  runMode: 'gpu' | 'cpu_only' | 'cpu_offload';
}

const FIT_LABEL: Record<VoiceFitLevel, string> = {
  perfect: 'Perfect fit',
  good: 'Good fit',
  marginal: 'Marginal',
  too_tight: 'Too tight',
};

/** Map voice catalog VRAM estimate to a fit badge using the hardware snapshot. */
export function analyzeSttFit(entry: SttCatalogEntry, hw: HardwareSnapshot): VoiceFitResult {
  const requiredGb = entry.estVramGb;
  const gpuVram = hw.hasGpu ? (hw.gpuVramGb ?? 0) : 0;
  const ramGb = hw.availableRamGb ?? 0;

  if (gpuVram > 0 && requiredGb <= gpuVram * 0.5) {
    return { fitLevel: 'perfect', label: FIT_LABEL.perfect, runMode: 'gpu' };
  }
  if (gpuVram > 0 && requiredGb <= gpuVram) {
    return { fitLevel: 'good', label: FIT_LABEL.good, runMode: 'gpu' };
  }
  if (gpuVram > 0 && requiredGb <= gpuVram * 1.15) {
    return { fitLevel: 'marginal', label: FIT_LABEL.marginal, runMode: 'cpu_offload' };
  }
  if (entry.cpuOk && requiredGb <= ramGb * 0.5) {
    return { fitLevel: 'good', label: 'CPU OK', runMode: 'cpu_only' };
  }
  if (entry.cpuOk && requiredGb <= ramGb) {
    return { fitLevel: 'marginal', label: 'CPU tight', runMode: 'cpu_only' };
  }
  return { fitLevel: 'too_tight', label: FIT_LABEL.too_tight, runMode: 'cpu_only' };
}

/** Map TTS catalog VRAM estimate to a fit badge using the hardware snapshot. */
export function analyzeTtsFit(entry: TtsCatalogEntry, hw: HardwareSnapshot): VoiceFitResult {
  if (entry.mode === 'tokenizer' || entry.estVramGb <= 0) {
    return { fitLevel: 'good', label: 'Dependency', runMode: 'gpu' };
  }
  const requiredGb = entry.estVramGb;
  const gpuVram = hw.hasGpu ? (hw.gpuVramGb ?? 0) : 0;
  const ramGb = hw.availableRamGb ?? 0;

  if (gpuVram > 0 && requiredGb <= gpuVram * 0.5) {
    return { fitLevel: 'perfect', label: FIT_LABEL.perfect, runMode: 'gpu' };
  }
  if (gpuVram > 0 && requiredGb <= gpuVram) {
    return { fitLevel: 'good', label: FIT_LABEL.good, runMode: 'gpu' };
  }
  if (gpuVram > 0 && requiredGb <= gpuVram * 1.15) {
    return { fitLevel: 'marginal', label: FIT_LABEL.marginal, runMode: 'cpu_offload' };
  }
  if (requiredGb <= ramGb * 0.5) {
    return { fitLevel: 'marginal', label: 'CPU tight', runMode: 'cpu_only' };
  }
  return { fitLevel: 'too_tight', label: FIT_LABEL.too_tight, runMode: 'cpu_only' };
}

export const VOICE_FIT_BADGE_CLASS: Record<VoiceFitLevel, string> = {
  perfect: 'models-fit-badge--perfect',
  good: 'models-fit-badge--good',
  marginal: 'models-fit-badge--marginal',
  too_tight: 'models-fit-badge--tight',
};
