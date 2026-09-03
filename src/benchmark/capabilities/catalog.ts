/**
 * Capability matrix catalog — 52 definitions in spreadsheet column order.
 */

import { CAPABILITY_CATALOG_ENTRIES } from './catalog-entries.ts';
import { CAPABILITY_PROBE_BY_ID } from './probes.ts';
import type { CapabilityDefinition } from './types.ts';

function buildDefinition(entry: typeof CAPABILITY_CATALOG_ENTRIES[number]): CapabilityDefinition {
  const base: CapabilityDefinition = {
    id: entry.id,
    group: entry.group,
    header: entry.header,
    tier: entry.tier,
    scoreMode: entry.scoreMode,
    howToTest: entry.howToTest,
    setup: entry.setup,
    prompt: entry.prompt,
    passCriteria: entry.passCriteria,
  };
  if (entry.scoreMode === 'manual') {
    base.manualReason = entry.manualReason;
    return base;
  }
  const probe = CAPABILITY_PROBE_BY_ID[entry.id];
  if (probe) base.probe = probe;
  return base;
}

/** All capabilities in spreadsheet order (stable ids). */
export const CAPABILITY_CATALOG: CapabilityDefinition[] = CAPABILITY_CATALOG_ENTRIES.map(buildDefinition);

export function getCapabilityById(id: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((c) => c.id === id);
}

export function listCapabilitiesByGroup(group: CapabilityDefinition['group']): CapabilityDefinition[] {
  return CAPABILITY_CATALOG.filter((c) => c.group === group);
}
