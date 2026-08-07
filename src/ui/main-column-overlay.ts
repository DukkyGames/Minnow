/**
 * Shared main-column overlay chrome — CSS classes and DOM suppression for
 * Code overview, code map, orchestrate hub, plan screen, and Issues embeds.
 */

const CHAT_AREA_OVERLAY_CLASSES = [
  'chat-area--code-overview',
  'chat-area--code-brain-map',
  'chat-area--orchestrate-hub',
  'chat-area--plan-screen',
  'chat-area--issues',
  'chat-area--dev-server',
  'chat-area--source-control',
  'chat-area--research',
] as const;

const MAIN_COLUMN_OVERLAY_CLASSES = [
  'main-column--code-overview',
  'main-column--code-brain-map',
  'main-column--plan-screen',
  'main-column--issues',
  'main-column--dev-server',
  'main-column--source-control',
  'main-column--research',
] as const;

/** Remove overlay modifier classes from #chatArea and #mainColumn. */
export function stripMainColumnOverlayClasses(): void {
  const area = document.getElementById('chatArea');
  const main = document.getElementById('mainColumn');
  for (const className of CHAT_AREA_OVERLAY_CLASSES) {
    area?.classList.remove(className);
  }
  for (const className of MAIN_COLUMN_OVERLAY_CLASSES) {
    main?.classList.remove(className);
  }
}

/**
 * True when a full-column overlay is showing and chat transcript DOM should not mount.
 * Uses DOM markers only — safe to import from streaming-state without circular deps.
 */
export function isMainColumnOverlaySuppressingChatDom(): boolean {
  if (document.getElementById('codeOverviewRoot')) return true;
  if (document.getElementById('codeBrainMapRoot')) return true;
  if (document.getElementById('orchestrateHub')) return true;
  if (document.getElementById('orchestratePlanScreen')) return true;
  if (document.getElementById('devServerScreenRoot')) return true;
  if (document.getElementById('sourceControlCenterRoot')) return true;

  const area = document.getElementById('chatArea');
  if (!area) return false;
  // Issues reparents #issuesView into #chatArea when opened from the Code sidebar.
  if (area.contains(document.getElementById('issuesView'))) return true;
  if (document.getElementById('researchView') && area.contains(document.getElementById('researchView'))) {
    return true;
  }
  for (const className of CHAT_AREA_OVERLAY_CLASSES) {
    if (area.classList.contains(className)) return true;
  }
  return false;
}
