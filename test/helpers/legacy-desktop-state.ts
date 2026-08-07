/**
 * Test-only stubs after Phase 5 removed the desktop surface module.
 * Production code must not import this file.
 */

export function resetDesktopStateForTests(): void {
  /* no-op */
}

export function setDesktopStateForTests(_mode?: string): void {
  /* no-op */
}

export function isDesktopChatActive(): boolean {
  return false;
}

export function isDesktopExpertsActive(): boolean {
  return false;
}

export async function activateDesktopExperts(): Promise<void> {
  /* no-op */
}
