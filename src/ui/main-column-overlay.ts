/**
 * Shared main-column overlay chrome — CSS classes and DOM suppression for
 * Code overview, code map, orchestrate hub, and plan screen overlays.
 */

const CHAT_AREA_OVERLAY_CLASSES = [
  'chat-area--code-overview',
  'chat-area--code-brain-map',
  'chat-area--orchestrate-hub',
  'chat-area--plan-screen',
  'chat-area--dev-server',
] as const;

const MAIN_COLUMN_OVERLAY_CLASSES = [
  'main-column--code-overview',
  'main-column--code-brain-map',
  'main-column--plan-screen',
  'main-column--dev-server',
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
  const area = document.getElementById('chatArea');
  if (!area) return false;
  if (document.getElementById('codeOverviewRoot')) return true;
  if (document.getElementById('codeBrainMapRoot')) return true;
  if (document.getElementById('orchestrateHub')) return true;
  if (document.getElementById('orchestratePlanScreen')) return true;
  if (document.getElementById('devServerScreenRoot')) return true;
  for (const className of CHAT_AREA_OVERLAY_CLASSES) {
    if (area.classList.contains(className)) return true;
  }
  return false;
}
