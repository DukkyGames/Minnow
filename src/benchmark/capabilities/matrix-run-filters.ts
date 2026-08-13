/**
 * Capability matrix run filters (group bands, probe waves, skip-scored).
 */

import type { CapabilityDefinition, CapabilityGroupId } from './types.ts';
import {
  type CapabilityMatrixProbeWave,
  probeWaveForCapabilityId,
} from './probe-wave-ids.ts';

export type { CapabilityMatrixProbeWave } from './probe-wave-ids.ts';

export const CAPABILITY_MATRIX_PROBE_WAVES: CapabilityMatrixProbeWave[] = [
  '2b',
  '2c',
  '2d',
  '2e',
  '2f',
];

export const CAPABILITY_MATRIX_PROBE_WAVE_LABELS: Record<CapabilityMatrixProbeWave, string> = {
  '2b': '2b — core protocol (no server)',
  '2c': '2c — workspace + git',
  '2d': '2d — emit-only tools',
  '2e': '2e — conditional / LSP',
  '2f': '2f — delegated / derived',
};

/** Run-time filter fields (subset of {@link CapabilityMatrixRunOptions} without importing types). */
export interface MatrixRunFilterOptions {
  groupIds?: CapabilityGroupId[];
  probeWaves?: CapabilityMatrixProbeWave[];
  skipScored?: boolean;
  skipCapabilityIds?: readonly string[];
}

/** Map an auto capability to its probe wave; manual rows return null. */
export function probeWaveForCapability(
  cap: CapabilityDefinition,
): CapabilityMatrixProbeWave | null {
  if (cap.scoreMode === 'manual') return null;
  return probeWaveForCapabilityId(cap.id);
}

/** Skip reason when run filters exclude a row; null when the probe should proceed to env gates. */
export function resolveMatrixRunFilterSkip(
  cap: CapabilityDefinition,
  options: MatrixRunFilterOptions | undefined,
): string | null {
  if (!options) return null;

  if (options.groupIds?.length && !options.groupIds.includes(cap.group)) {
    return 'filtered (capability group)';
  }

  if (options.probeWaves?.length) {
    const wave = probeWaveForCapability(cap);
    if (wave && !options.probeWaves.includes(wave)) {
      return 'filtered (probe wave)';
    }
  }

  if (
    options.skipScored &&
    options.skipCapabilityIds?.length &&
    options.skipCapabilityIds.includes(cap.id)
  ) {
    return 'already scored';
  }

  return null;
}

/** Probe keys persisted during an interrupted sweep (`targetKey::capabilityId`). */
export function capabilityIdsFromProbeKeys(
  probeKeys: string[] | undefined,
  targetKey: string,
): string[] {
  if (!probeKeys?.length) return [];
  const prefix = `${targetKey}::`;
  return probeKeys
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

/** Default: all group bands selected. */
export function allCapabilityGroupIds(): CapabilityGroupId[] {
  return [
    'core-protocol',
    'files',
    'docs',
    'git',
    'code-shell',
    'lsp',
    'web',
    'browser',
    'agents-tasks',
    'knowledge',
    'apps',
    'mode-control',
    'features',
  ];
}
