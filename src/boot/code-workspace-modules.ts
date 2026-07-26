/**
 * Lazy initialization for Code workspace modules (editor, terminal, orchestrate hub).
 * Deferred on MinnowOS desktop cold start so the entry chunk stays smaller.
 */

let initialized = false;
let initPromise: Promise<void> | null = null;

/** Wire file panel, terminal, and code overview once Code workspace is needed. */
export function ensureCodeWorkspaceModules(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      const filePanel = await import('../ui/init-file-panel');
      await filePanel.initFilePanel();
      filePanel.onFilePanelServerAvailabilityChanged();

      const terminal = await import('../ui/terminal-panel');
      await terminal.initTerminalPanel();
      terminal.onTerminalServerAvailabilityChanged();

      const { initShellRunUi } = await import('../ui/shell-run-ui');
      initShellRunUi();

      const { initCodeBrainMap } = await import('../ui/code-brain-map');
      initCodeBrainMap();

      const { initCodeOverview } = await import('../ui/code-overview');
      initCodeOverview();

      const { initDevServerScreen } = await import('../ui/dev-server-screen');
      initDevServerScreen();

      const { initOrchestrateHub } = await import('../ui/orchestrate-hub');
      initOrchestrateHub();

      const { initCodeChangeStrip } = await import('../ui/code-change-strip');
      initCodeChangeStrip();

      const { initOrchestrateStatsLiveRefresh } = await import('../chat/orchestrate/stats-live');
      initOrchestrateStatsLiveRefresh();

      terminal.registerTerminalKeyboardShortcut();
      initialized = true;
    })();
  }
  return initPromise;
}

/** Reset lazy-init state (tests). */
export function resetCodeWorkspaceModulesForTests(): void {
  initialized = false;
  initPromise = null;
}

function isCodeBootRoute(): boolean {
  const hash = window.location.hash;
  return hash.startsWith('#/app/code') || hash === '#/code' || hash.startsWith('#/code/');
}

/** Initialize code workspace modules immediately when the boot hash targets Code. */
export async function ensureCodeWorkspaceModulesForBoot(): Promise<void> {
  if (isCodeBootRoute()) {
    await ensureCodeWorkspaceModules();
  }
}

/** Re-sync file tree / terminal offline state after a later detectLocalServer() probe. */
export async function notifyCodeWorkspaceServerAvailability(): Promise<void> {
  if (!initialized) return;
  const filePanel = await import('../ui/init-file-panel');
  filePanel.onFilePanelServerAvailabilityChanged();
  const terminal = await import('../ui/terminal-panel');
  terminal.onTerminalServerAvailabilityChanged();
}
