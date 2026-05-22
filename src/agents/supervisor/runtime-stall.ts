/**
 * Runtime stall window for R8 (reflects Settings without recompiling).
 */

import { getSupervisorConfigSnapshot } from './config.ts';
import { ORCHESTRATE_WATCHDOG_STALL_MS } from './detector.ts';

export function getOrchestrateWatchdogStallMs(): number {
  return getSupervisorConfigSnapshot().stallMs ?? ORCHESTRATE_WATCHDOG_STALL_MS;
}
