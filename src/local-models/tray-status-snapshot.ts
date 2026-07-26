/** Build the tray status payload from agent count + local models. */

import type { MinnowTrayLoadedModelRow, MinnowTrayStatusSnapshot } from '../electron.d.ts';

export function buildTrayStatusSnapshot(
  runningAgentCount: number,
  loadedLocalModels: MinnowTrayLoadedModelRow[],
): MinnowTrayStatusSnapshot {
  return {
    runningAgentCount: Math.max(0, runningAgentCount),
    loadedLocalModels,
  };
}
