/**
 * Self-healing controller — disabled while supervisor auto-recovery is removed.
 */

/** No-op: repetition auto-restart removed with supervisor. */
export function observeSubAgentToolCall(..._args: unknown[]): void {
  /* disabled */
}

/** No-op: clears nothing (tests may still call). */
export function resetSelfHealingState(): void {
  /* disabled */
}
