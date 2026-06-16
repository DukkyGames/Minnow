/**
 * Controller watchdog — placeholder for heartbeat / tiered recovery (Phase 3).
 * Repetition auto-restart was removed with the old supervisor; logic returns in MIN-140 Phase 3.
 */

/** No-op: repetition auto-restart removed with supervisor. */
export function observeSubAgentToolCall(..._args: unknown[]): void {
  /* disabled until Phase 3 watchdog */
}

/** No-op: clears nothing (tests may still call). */
export function resetWatchdogState(): void {
  /* disabled until Phase 3 watchdog */
}

/** @deprecated Use resetWatchdogState — kept for self-healing shim compatibility. */
export const resetSelfHealingState = resetWatchdogState;
