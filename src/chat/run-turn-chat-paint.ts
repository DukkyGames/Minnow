/**
 * P6-A — map presentation-free `TurnEvent`s onto the existing chat DOM helpers.
 *
 * The runner emits cumulative `delta` / `thinking` snapshots (full text so far),
 * not per-token increments. Chat already paints full markdown via
 * `scheduleAssistantBubbleRender`; thinking helpers take deltas, so this file
 * diffs the snapshot. Do not change `TurnEvent` here — that would be a Phase 6
 * finding. Per-event paint lag is Phase 7 (MIN-727), not this spike.
 */

import type { TurnEvent } from '../../server/runner/run-turn';
import {
  scheduleAssistantBubbleRender,
} from '../markdown/renderer';
import { revealAssistantProseBubble } from '../ui/messages';
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
}

export interface ChatTurnPaintSnapshot {
  lastDelta: string;
  lastThinking: string;
  toolCallCount: number;
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

/**
 * Drive the existing stream / thinking / tool rows from `onEvent`.
 * Import these helpers — do not fork a second transcript painter.
 */
export function createChatTurnEventPainter(host: ChatTurnPaintHost): {
  onEvent: (event: TurnEvent) => void;
  snapshot: () => ChatTurnPaintSnapshot;
  /** Retarget live handles after a stream-dom remount (chat switch). */
  retarget: (next: Partial<ChatTurnPaintHost>) => void;
} {
  let lastDelta = '';
  let lastThinking = '';
  let toolCallCount = 0;
  let proseRevealed = false;
  const toolWraps = new Map<string, HTMLElement>();
  // Last tool name from `tool_streaming` — remount re-shows "Calling {tool}…".
  let lastStreamingToolName: string | null = null;
  let toolStart: ToolStartIndicatorHandle | null = null;

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

  const onEvent = (event: TurnEvent): void => {
    host.onActivity?.();
    if (event.type === 'delta') {
      lastDelta = event.text;
      if (!proseRevealed && event.text.trim()) {
        proseRevealed = true;
        host.revealProse();
        revealAssistantProseBubble(host.wrap, host.bubble, host.streamStatus);
      }
      scheduleAssistantBubbleRender(host.bubble, event.text, host.cursor);
      return;
    }
    if (event.type === 'thinking') {
      const added = thinkingDeltaFromSnapshot(lastThinking, event.text);
      lastThinking = event.text;
      if (added) host.thoughtController.appendReasoningDelta(added);
      return;
    }
    if (event.type === 'tool_streaming') {
      lastStreamingToolName = event.name;
      bindToolStartIndicator();
      return;
    }
    if (event.type === 'tool_call') {
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
    retarget(next) {
      if (next.wrap) host.wrap = next.wrap;
      if (next.bubble) host.bubble = next.bubble;
      if (next.cursor) host.cursor = next.cursor;
      if (next.streamStatus) host.streamStatus = next.streamStatus;
      if (next.mount) host.mount = next.mount;
      if (next.thoughtController) host.thoughtController = next.thoughtController;
      if (next.revealProse) host.revealProse = next.revealProse;
      if (proseRevealed && lastDelta && next.bubble) {
        scheduleAssistantBubbleRender(next.bubble, lastDelta, next.cursor ?? host.cursor);
      }
      // Chat switch rebuilds the streaming shell; keep "Calling {tool}…" if args
      // are still streaming (MIN-2 leftover, now an overlay around runTurn).
      bindToolStartIndicator();
    },
  };
}
