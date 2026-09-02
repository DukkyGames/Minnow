import { estimateTokensFromText } from './prompts/token-estimate-core';

/** Snapshot of outbound content still streaming or not yet pushed to history. */
export interface ContextInFlightOverlay {
  chatId: string;
  partialAssistantText?: string;
  thinkingText?: string;
  pendingToolCallsJson?: string;
}

let activeOverlay: ContextInFlightOverlay | null = null;

let overlayWriteCount = 0;

/** Replace or clear the overlay for the active turn (P10-I: coalesced paint + tool_call). */
export function setContextInFlightOverlay(overlay: ContextInFlightOverlay | null): void {
  overlayWriteCount += 1;
  activeOverlay = overlay;
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
  activeOverlay = null;
}

/** Overlay fields for a chat when the ring should count in-progress tokens. */
export function getContextInFlightOverlay(
  chatId: string,
): Omit<ContextInFlightOverlay, 'chatId'> | undefined {
  if (!activeOverlay || activeOverlay.chatId !== chatId) return undefined;
  return {
    partialAssistantText: activeOverlay.partialAssistantText,
    thinkingText: activeOverlay.thinkingText,
    pendingToolCallsJson: activeOverlay.pendingToolCallsJson,
  };
}

export function estimateInFlightOverlayTokens(
  overlay: Omit<ContextInFlightOverlay, 'chatId'> | undefined,
): number {
  if (!overlay?.pendingToolCallsJson) return 0;
  return estimateTokensFromText(overlay.pendingToolCallsJson, 'payload');
}
