/**
 * P6-A / P7-B — map presentation-free `TurnEvent`s onto the existing chat DOM helpers.
 *
 * The runner emits cumulative `delta` / `thinking` snapshots (full text so far),
 * not per-token increments. Chat already paints full markdown via
 * `scheduleAssistantBubbleRender`; thinking helpers take deltas, so this file
 * diffs the snapshot against the last *painted* text.
 *
 * P7-B (MIN-729): delta + thinking presentation is coalesced onto one animation
 * frame (or a 0 ms timeout when rAF is missing). Latest snapshot wins so a burst
 * of events is one markdown schedule and one scroll, not N. Discrete tool rows
 * stay immediate — they are not token-grained.
 */

import type { TurnEvent } from '../../server/runner/run-turn';
import {
  scheduleAssistantBubbleRender,
} from '../markdown/renderer';
import { revealAssistantProseBubble } from '../ui/messages';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import type { ThoughtBubbleController } from '../ui/thought-bubbles';
import {
  attachToolStartIndicator,
  type StreamingStatusHandle,
  type ToolStartIndicatorHandle,
} from '../ui/stream-status';

/** DOM + thought controller the live `runChatTurn` path already owns. */
export interface ChatTurnPaintHost {
  wrap: HTMLElement;
  bubble: HTMLElement;
  cursor: HTMLElement;
  streamStatus?: StreamingStatusHandle;
  thoughtController: Pick<ThoughtBubbleController, 'appendReasoningDelta'>;
  /** Transcript mount that receives `.tool-call-msg` rows. */
  mount: HTMLElement;
  /** First prose token reveals the awaiting bubble. */
  revealProse: () => void;
  /** Optional activity ping (sidebar dots, stream-activity listeners). */
  onActivity?: () => void;
  /**
   * Stream follow-scroll. Defaults to `scrollChatIfPinned`.
   * Live thinking no longer scrolls inside ThoughtBubbleController (MIN-729).
   */
  scrollTranscript?: () => void;
  /** Override markdown schedule (tests count calls without lexing). */
  scheduleMarkdown?: (
    bubble: HTMLElement,
    markdown: string,
    streamCursor: HTMLElement,
  ) => void;
  /**
   * Queue the next paint. Defaults to `requestAnimationFrame` so many
   * TurnEvents in one SSE `read()` become one layout. Tests pump ticks.
   */
  schedulePaintTick?: (cb: () => void) => void;
  /**
   * After a coalesced thinking/delta paint. Live stats schedule from here so
   * a token burst is one snapshot, not N joins of thinking text.
   */
  onCoalescedPaint?: (snap: ChatTurnPaintSnapshot) => void;
}

export interface ChatTurnPaintSnapshot {
  lastDelta: string;
  lastThinking: string;
  toolCallCount: number;
}

export interface ChatTurnEventPainter {
  onEvent: (event: TurnEvent) => void;
  snapshot: () => ChatTurnPaintSnapshot;
  /** Apply any pending delta/thinking now (end of turn, tests, before tool rows). */
  flush: () => void;
  /** Retarget live handles after a stream-dom remount (chat switch). */
  retarget: (next: Partial<ChatTurnPaintHost>) => void;
}

/**
 * `TurnEvent.thinking` is the full reasoning so far. Thought bubbles append.
 * Prefix-diff when we can; otherwise replace by feeding the new snapshot.
 */
export function thinkingDeltaFromSnapshot(previous: string, next: string): string {
  if (!next) return '';
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

/** Wire `arguments` may still be a JSON string. `renderToolCall` wants an object. */
export function coerceToolCallArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

/** rAF when the compositor is about to paint; setTimeout(0) in node / missing rAF. */
function defaultSchedulePaintTick(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      cb();
    });
    return;
  }
  setTimeout(cb, 0);
}

/**
 * Drive the existing stream / thinking / tool rows from `onEvent`.
 * Import these helpers — do not fork a second transcript painter.
 */
export function createChatTurnEventPainter(host: ChatTurnPaintHost): ChatTurnEventPainter {
  let lastDelta = '';
  let lastThinking = '';
  // Prefix-diff thinking against what the DOM has, not the latest queued snapshot.
  let lastPaintedThinking = '';
  let pendingDelta: string | null = null;
  let pendingThinking: string | null = null;
  let paintScheduled = false;
  let toolCallCount = 0;
  let proseRevealed = false;
  const toolWraps = new Map<string, HTMLElement>();
  // Last tool name from `tool_streaming` — remount re-shows "Calling {tool}…".
  let lastStreamingToolName: string | null = null;
  let toolStart: ToolStartIndicatorHandle | null = null;

  const scheduleMarkdown =
    host.scheduleMarkdown ??
    ((bubble: HTMLElement, markdown: string, streamCursor: HTMLElement) => {
      // Painter already scrolls once per tick; skip the markdown flush's layout.
      scheduleAssistantBubbleRender(bubble, markdown, streamCursor, { pinScroll: false });
    });
  const scrollTranscript = host.scrollTranscript ?? scrollChatIfPinned;
  const schedulePaintTick = host.schedulePaintTick ?? defaultSchedulePaintTick;

  const bindToolStartIndicator = (): void => {
    toolStart?.dispose();
    toolStart = null;
    if (!lastStreamingToolName || !host.streamStatus) return;
    toolStart = attachToolStartIndicator({
      wrap: host.wrap,
      bubble: host.bubble,
      cursor: host.cursor,
      streamStatus: host.streamStatus,
    });
    toolStart.show(lastStreamingToolName);
  };

  const clearToolStartIndicator = (): void => {
    lastStreamingToolName = null;
    toolStart?.dispose();
    toolStart = null;
  };

  const flushPaint = (): void => {
    paintScheduled = false;
    const thinkingSnap = pendingThinking;
    const deltaSnap = pendingDelta;
    pendingThinking = null;
    pendingDelta = null;
    if (thinkingSnap === null && deltaSnap === null) return;

    if (thinkingSnap !== null) {
      const added = thinkingDeltaFromSnapshot(lastPaintedThinking, thinkingSnap);
      lastPaintedThinking = thinkingSnap;
      if (added) host.thoughtController.appendReasoningDelta(added);
    }

    if (deltaSnap !== null) {
      if (!proseRevealed && deltaSnap.trim()) {
        proseRevealed = true;
        host.revealProse();
        revealAssistantProseBubble(host.wrap, host.bubble, host.streamStatus);
      }
      scheduleMarkdown(host.bubble, deltaSnap, host.cursor);
    }

    // One forced layout per tick covers thinking-only and prose streams.
    scrollTranscript();
    host.onCoalescedPaint?.({ lastDelta, lastThinking, toolCallCount });
  };

  const schedulePaint = (): void => {
    if (paintScheduled) return;
    paintScheduled = true;
    schedulePaintTick(() => {
      flushPaint();
    });
  };

  const onEvent = (event: TurnEvent): void => {
    host.onActivity?.();
    if (event.type === 'delta') {
      lastDelta = event.text;
      pendingDelta = event.text;
      schedulePaint();
      return;
    }
    if (event.type === 'thinking') {
      lastThinking = event.text;
      pendingThinking = event.text;
      schedulePaint();
      return;
    }
    // Tool rows are discrete, not token-grained — flush any pending prose first
    // so thinking/delta already received appear above the Calling… / result row.
    if (event.type === 'tool_streaming') {
      flushPaint();
      lastStreamingToolName = event.name;
      bindToolStartIndicator();
      return;
    }
    if (event.type === 'tool_call') {
      flushPaint();
      clearToolStartIndicator();
      toolCallCount += 1;
      const args = coerceToolCallArgs(event.arguments);
      const wrap = renderToolCall(event.name, args);
      if (event.id) wrap.dataset.toolCallId = event.id;
      const key = event.id ?? `${event.name}:${toolCallCount}`;
      toolWraps.set(key, wrap);
      host.mount.appendChild(wrap);
      return;
    }
    if (event.type === 'tool_result') {
      flushPaint();
      const key = event.id
        ? event.id
        : [...toolWraps.keys()].find((k) => k.startsWith(`${event.name}:`));
      const wrap = (event.id && toolWraps.get(event.id)) || (key ? toolWraps.get(key) : undefined);
      if (wrap) renderToolResult(wrap, event.content);
    }
  };

  return {
    onEvent,
    snapshot: () => ({ lastDelta, lastThinking, toolCallCount }),
    flush: flushPaint,
    retarget(next) {
      if (next.wrap) host.wrap = next.wrap;
      if (next.bubble) host.bubble = next.bubble;
      if (next.cursor) host.cursor = next.cursor;
      if (next.streamStatus) host.streamStatus = next.streamStatus;
      if (next.mount) host.mount = next.mount;
      if (next.thoughtController) host.thoughtController = next.thoughtController;
      if (next.revealProse) host.revealProse = next.revealProse;
      // Apply queued snapshots onto the new shell before rebinding chrome.
      flushPaint();
      if (proseRevealed && lastDelta && next.bubble) {
        scheduleMarkdown(next.bubble, lastDelta, next.cursor ?? host.cursor);
      }
      // Chat switch rebuilds the streaming shell; keep "Calling {tool}…" if args
      // are still streaming (MIN-2 leftover, now an overlay around runTurn).
      bindToolStartIndicator();
    },
  };
}
