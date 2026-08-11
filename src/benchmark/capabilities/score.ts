/**
 * Capability matrix row scoring (mirrors spreadsheet formula).
 */

import type { CapabilityVerdict } from './types.ts';

const SCORED: CapabilityVerdict[] = ['pass', 'partial', 'fail'];

/** Row score: (pass + 0.5·partial) / (pass + partial + fail). Null when nothing scored. */
export function capabilityRowScore(verdicts: CapabilityVerdict[]): number | null {
  let pass = 0;
  let partial = 0;
  let fail = 0;
  for (const v of verdicts) {
    if (v === 'pass') pass += 1;
    else if (v === 'partial') partial += 1;
    else if (v === 'fail') fail += 1;
  }
  const denominator = pass + partial + fail;
  if (denominator === 0) return null;
  return (pass + 0.5 * partial) / denominator;
}

/** Count of cells with a scored verdict (pass, partial, or fail). */
export function capabilityRowTestedCount(verdicts: CapabilityVerdict[]): number {
  return verdicts.filter((v) => SCORED.includes(v)).length;
}
