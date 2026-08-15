/**
 * Shared in-flight guard for model load/unload (UI picker + benchmark campaigns).
 */

export type ModelLoadLockOwner = 'ui' | 'benchmark';

export type ModelLoadUnloadPhase = 'load' | 'unload';

let inFlight = false;
let phase: ModelLoadUnloadPhase | null = null;
let owner: ModelLoadLockOwner | null = null;
/** #modelSelect option value for the row currently loading or unloading (UI only). */
let targetSelectValue: string | null = null;

/** True while a model load or unload request is running. */
export function isModelLoadLockBusy(): boolean {
  return inFlight;
}

/** Which subsystem holds the lock, when {@link isModelLoadLockBusy} is true. */
export function getModelLoadLockOwner(): ModelLoadLockOwner | null {
  return owner;
}

/** Current load/unload phase when the lock is held. */
export function getModelLoadLockPhase(): ModelLoadUnloadPhase | null {
  return phase;
}

/** Option value for the in-flight UI load/unload action. */
export function getModelLoadLockTargetSelectValue(): string | null {
  return targetSelectValue;
}

/** User-facing hint when the lock is held by another owner. */
export function modelLoadLockHeldLabel(): string | null {
  if (!inFlight || !owner) return null;
  if (owner === 'benchmark') return 'Held by capability matrix run';
  return null;
}

/** Mark the start of a load/unload action for an owner. */
export function beginModelLoadLock(
  lockOwner: ModelLoadLockOwner,
  nextPhase: ModelLoadUnloadPhase,
  selectValue?: string,
): void {
  inFlight = true;
  owner = lockOwner;
  phase = nextPhase;
  const trimmed = selectValue?.trim();
  targetSelectValue = trimmed || null;
}

/** Mark the end of a load/unload action (must match {@link getModelLoadLockOwner}). */
export function endModelLoadLock(lockOwner: ModelLoadLockOwner): void {
  if (owner !== lockOwner) return;
  inFlight = false;
  owner = null;
  phase = null;
  targetSelectValue = null;
}

/** Reset lock state (tests only). */
export function resetModelLoadLockForTests(): void {
  inFlight = false;
  owner = null;
  phase = null;
  targetSelectValue = null;
}
