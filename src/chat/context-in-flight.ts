/**
 * In-flight context overlay for BUG-019 — tokens not yet in chat.history during a turn.
 */

import { estimateTokensFromText } from './prompts/token-estimate-core';

/** Snapshot of outbound content still streaming or not yet pushed to history. */
export interface ContextInFlightOverlay {
  chatId: string;
  partialAssistantText?: string;
  thinkingText?: string;
  pendingToolCallsJson?: string;
}

let activeOverlay: ContextInFlightOverlay | null = null;

/** Replace or clear the overlay for the active turn (call from loop.ts). */
export function setContextInFlightOverlay(overlay: ContextInFlightOverlay | null): void {
  activeOverlay = overlay;
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

/**
 * Heuristic token count for in-flight overlay fields (chars ÷ 4).
 * Only unfinalized tool-call JSON counts toward the next prompt; streaming
 * completion prose and live reasoning are output channels, not prompt input.
 */
export function estimateInFlightOverlayTokens(
  overlay: Omit<ContextInFlightOverlay, 'chatId'> | undefined,
): number {
  if (!overlay?.pendingToolCallsJson) return 0;
  return estimateTokensFromText(overlay.pendingToolCallsJson);
}
