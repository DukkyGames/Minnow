/**
 * Accumulate reasoning SSE during engine main-chat turns for history persistence.
 * Mirrors renderer ThoughtBubbleController + ThinkingDurationTracker semantics.
 */

import { extractStreamDelta } from '../api/chat';
import {
  extractReasoningDelta,
  extractReasoningSignatureDelta,
  splitThinkingSegments,
} from '../api/reasoning';
import type { ChatCompletionChunk } from '../types';
import { ThinkingDurationTracker } from '../ui/thinking-duration';

export interface EngineReasoningCaptureResult {
  segments: string[];
  durationMs: number;
  thinkingSignature?: string;
}

/** Per-turn reasoning accumulator for DOM-less engine streaming. */
export class EngineReasoningCapture {
  private buffer = '';

  private thinkingSignature = '';

  private tracker = new ThinkingDurationTracker();

  private reasoningOpen = false;

  /** Ingest one streamed completion chunk (reasoning + prose). */
  onChunk(chunk: ChatCompletionChunk): void {
    const reasoning = extractReasoningDelta(chunk);
    if (reasoning) {
      if (!this.reasoningOpen) {
        this.reasoningOpen = true;
        this.tracker.startSegment();
      }
      this.buffer += reasoning;
    }

    const signature = extractReasoningSignatureDelta(chunk);
    if (signature) {
      this.thinkingSignature = signature;
    }

    const prose = extractStreamDelta(chunk);
    if (prose && this.reasoningOpen) {
      this.reasoningOpen = false;
      this.tracker.endSegment();
    }
  }

  /** Close any open segment and return normalized fields for Chat.history. */
  finalize(): EngineReasoningCaptureResult {
    if (this.reasoningOpen) {
      this.reasoningOpen = false;
      this.tracker.endSegment();
    }

    const trimmed = this.buffer.trim();
    const segments = trimmed
      ? splitThinkingSegments(trimmed).length > 0
        ? splitThinkingSegments(trimmed)
        : [trimmed]
      : [];

    return {
      segments,
      durationMs: this.tracker.finalizeRound(),
      thinkingSignature: this.thinkingSignature.trim() || undefined,
    };
  }
}

/**
 * Build optional assistant history fields from captured reasoning.
 * Omits empty keys so session JSON stays compact.
 */
export function engineReasoningHistoryFields(
  capture: EngineReasoningCaptureResult,
): {
  thinking?: string[];
  thinkingDurationMs?: number;
  thinkingSignature?: string;
} {
  const out: {
    thinking?: string[];
    thinkingDurationMs?: number;
    thinkingSignature?: string;
  } = {};
  if (capture.segments.length > 0) {
    out.thinking = capture.segments;
  }
  if (capture.durationMs > 0) {
    out.thinkingDurationMs = capture.durationMs;
  }
  if (capture.thinkingSignature) {
    out.thinkingSignature = capture.thinkingSignature;
  }
  return out;
}
