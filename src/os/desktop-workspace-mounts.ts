/** Legacy desktop workspace drawer hosting — always false in workspace-first shell. */
export function isDesktopWorkspaceHostingActive(): boolean {
  return false;
}

/** Legacy sync hook — no-op. */
export async function syncDesktopWorkspaceMounts(): Promise<void> {
  /* no-op */
}

export function resetDesktopWorkspaceMountsForTests(): void {
  /* no-op */
}
