/**
 * Capability matrix auto probe catalog (split across probe modules).
 */

import { CORE_AND_FILES_PROBES } from './probes-auto-core-files.ts';
import { MODE_PROBES } from './probes-auto-modes.ts';
import { REMAINING_AUTO_PROBES } from './probes-auto-rest.ts';
import { SURFACE_PROBES } from './probes-auto-surfaces.ts';
import type { CapabilityProbeSpec } from './types.ts';

export const CAPABILITY_PROBE_BY_ID: Record<string, CapabilityProbeSpec> = {
  ...CORE_AND_FILES_PROBES,
  ...REMAINING_AUTO_PROBES,
  ...SURFACE_PROBES,
  ...MODE_PROBES,
};

export function getCapabilityProbe(capabilityId: string): CapabilityProbeSpec | undefined {
  return CAPABILITY_PROBE_BY_ID[capabilityId];
}
