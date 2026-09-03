import { estimateTokensFromText } from './prompts/token-estimate-core';

/** Snapshot of outbound content still streaming or not yet pushed to history. */
export interface ContextInFlightOverlay {
  chatId: string;
  partialAssistantText?: string;
  thinkingText?: string;
  pendingToolCallsJson?: string;
}

/** Per-chat overlays so concurrent streams cannot clobber each other (MIN-584). */
const overlays = new Map<string, ContextInFlightOverlay>();

let overlayWriteCount = 0;

/** Replace or clear overlays. `null` clears every chat (tests / full reset). */
export function setContextInFlightOverlay(overlay: ContextInFlightOverlay | null): void {
  overlayWriteCount += 1;
  if (!overlay) {
    overlays.clear();
    return;
  }
  overlays.set(overlay.chatId, overlay);
}

/** Drop the overlay for one chat without touching siblings still streaming. */
export function clearContextInFlightOverlay(chatId: string): void {
  overlays.delete(chatId);
}

export function syncTurnContextUsage(overlay: ContextInFlightOverlay): void {
  setContextInFlightOverlay(overlay);
}

/** Test hook: overlay writes must be at most one per paint tick, not per token. */
export function getContextOverlayWriteCountForTests(): number {
  return overlayWriteCount;
}

/** Test hook: reset overlay + write counter between cases. */
export function resetContextOverlayWriteCountForTests(): void {
  overlayWriteCount = 0;
  overlays.clear();
}

/** Overlay fields for a chat when the ring should count in-progress tokens. */
export function getContextInFlightOverlay(
  chatId: string,
): Omit<ContextInFlightOverlay, 'chatId'> | undefined {
  const overlay = overlays.get(chatId);
  if (!overlay) return undefined;
  return {
    partialAssistantText: overlay.partialAssistantText,
    thinkingText: overlay.thinkingText,
    pendingToolCallsJson: overlay.pendingToolCallsJson,
  };
}

export function estimateInFlightOverlayTokens(
  overlay: Omit<ContextInFlightOverlay, 'chatId'> | undefined,
): number {
  if (!overlay?.pendingToolCallsJson) return 0;
  return estimateTokensFromText(overlay.pendingToolCallsJson, 'payload');
}
