/**
 * P6-A / P7-B / P10-F — map presentation-free `TurnEvent`s onto existing chat DOM helpers.
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
 *
 * P10-F (MIN-771): a tool-bearing `round_end` finalizes the current assistant
 * row and opens a fresh streaming shell so live DOM matches `chat.history`
 * (assistant → tools → assistant). That is what stops thought lumping and the
 * stream-end scroll jump. rAF coalescing is unchanged.
 *
 * P10-H (MIN-773): tool rows reuse `chat-tool-batch` chrome — `parseToolArguments`,
 * full-arity `renderToolResult` (attachments / codeChange), `attachShellKillUi`,
 * `notifyMemorySavedFromTool`, and `resolveLiveToolWrap` so a mid-batch chat
 * switch does not strand the result. Do not fork those helpers here.
 */

import type { TurnEvent } from '../../server/runner/run-turn';
import {
  cancelAssistantBubbleRenderDebounce,
  finishStreamingBubbleRender,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import {
  anchorPersistedThoughtsOnRow,
  removeOrphanStreamingRow,
  revealAssistantProseBubble,
} from '../ui/messages';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import { attachShellKillUi } from '../ui/shell-run-ui';
import { notifyMemorySavedFromTool } from '../ui/memory-saved-toast';
import {
  renderThoughtsToggle,
  syncThoughtsCaretPulse,
  thoughtsScopeFromEl,
  type ThoughtBubbleController,
} from '../ui/thought-bubbles';
import {
  attachToolStartIndicator,
  type StreamingStatusHandle,
  type ToolStartIndicatorHandle,
} from '../ui/stream-status';
import {
  parseToolArguments,
  TOOL_ARGUMENTS_INVALID_JSON,
  type ParseToolArgumentsResult,
} from '../tools/parse-tool-arguments';
import { resolveLiveToolWrap } from '../tools/chat-tool-batch';
import type { CodeChangeStats, ToolImageAttachment } from '../types';
import { sessionState } from '../state/sessions';
import { isStreamDomVisible } from './streaming-state';

/**
 * Live thought controller plus the round-close methods P10-F needs.
 * Tests may stub only `appendReasoningDelta`; round-boundary tests stub consume.
 */
export type ChatTurnThoughtController = Pick<ThoughtBubbleController, 'appendReasoningDelta'> & {
  consumePersistedSegments?: ThoughtBubbleController['consumePersistedSegments'];
  endReasoningPhase?: ThoughtBubbleController['endReasoningPhase'];
  setAssistantWrap?: ThoughtBubbleController['setAssistantWrap'];
  resetStreamPhaseHints?: ThoughtBubbleController['resetStreamPhaseHints'];
  setThinkingElapsed?: ThoughtBubbleController['setThinkingElapsed'];
};

/** Closed-round notice so the caller can stamp `historyIndex` and message actions. */
export interface ChatTurnRoundFinalizedInfo {
  wrap: HTMLElement;
  text: string;
  toolCallCount: number;
  connected: boolean;
}

/** DOM + thought controller the live `runChatTurn` path already owns. */
export interface ChatTurnPaintHost {
  wrap: HTMLElement;
  bubble: HTMLElement;
  cursor: HTMLElement;
  streamStatus?: StreamingStatusHandle;
  thoughtController: ChatTurnThoughtController;
  /** Transcript mount that receives `.tool-call-msg` rows. */
  mount: HTMLElement;
  /**
   * Owning chat id for `attachShellKillUi` (run registry + Stop button).
   * Optional so painter unit tests that only assert rows can omit it.
   */
  chatId?: string;
  /**
   * When false, skip DOM writes so a mid-turn switch cannot paint into the
   * newly visible transcript. Defaults to `isStreamDomVisible(chatId)` when
   * `chatId` is set; tests without a chat always paint.
   */
  isDomVisible?: () => boolean;
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
  /** Chat mode for finalized markdown (tool-round close). */
  modeId?: string;
  /** Close the live thinking timer for this round; returns duration ms. */
  finalizeThinkingRound?: () => number;
  /**
   * After a tool-bearing round is finalized, open the next streaming shell.
   * The painter retargets onto the returned handles.
   */
  beginNextStreamingRow?: () => Partial<ChatTurnPaintHost> | void;
  /** History index / message actions after a round is closed in the DOM. */
  onRoundFinalized?: (info: ChatTurnRoundFinalizedInfo) => void;
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

export interface FinalizeThinkingRoundOpts {
  thoughtController: ChatTurnThoughtController | null | undefined;
  wrap: HTMLElement;
  streamStatus?: StreamingStatusHandle;
  hasProse: boolean;
  durationMs?: number;
  /** When false, skip DOM (background chat). Default true. */
  domVisible?: boolean;
}

/**
 * Close the live thinking stage for one model round (loop.ts `finalizeAndAnchorThinkingRound`).
 * Consumes the controller so the next round cannot lump thoughts onto this toggle.
 */
export function finalizeAndAnchorThinkingRound(
  opts: FinalizeThinkingRoundOpts,
): { segments: string[]; durationMs: number } {
  const segments = opts.thoughtController?.consumePersistedSegments?.() ?? [];
  const durationMs = opts.durationMs ?? 0;
  if (opts.domVisible === false) return { segments, durationMs };
  if (segments.length > 0) {
    const durationOpt = durationMs > 0 ? { durationMs } : {};
    if (opts.hasProse) {
      renderThoughtsToggle(opts.wrap, segments, durationOpt);
    } else {
      anchorPersistedThoughtsOnRow(opts.wrap, segments, {
        ...durationOpt,
        streamStatus: opts.streamStatus,
      });
    }
    syncThoughtsCaretPulse(thoughtsScopeFromEl(opts.wrap));
  } else if (!opts.hasProse) {
    removeOrphanStreamingRow(opts.wrap, opts.streamStatus);
  }
  return { segments, durationMs };
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

/**
 * TurnEvent.arguments is `unknown` (string on the wire, object after the
 * inner loop parses). Route strings through `parseToolArguments` so a
 * constrained-decoding miss is `{}` + parseError, not `{ raw: "…" }` which
 * used to render as a fake argument object (P10-H / MIN-773).
 */
export function parsePaintToolArguments(
  raw: unknown,
  constrained = true,
): ParseToolArgumentsResult {
  if (typeof raw === 'string') {
    return parseToolArguments(raw, { constrained });
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { args: raw as Record<string, unknown> };
  }
  if (constrained && raw != null) {
    return { args: {}, parseError: TOOL_ARGUMENTS_INVALID_JSON };
  }
  return { args: {} };
}

/** Display-only args from a `tool_call` event. Never returns `{ raw }`. */
export function coerceToolCallArgs(raw: unknown): unknown {
  return parsePaintToolArguments(raw).args;
}

/** P10-B `tool_result.attachments` is untyped on the wire. */
function asToolImageAttachments(raw: unknown): ToolImageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw as ToolImageAttachment[];
}

/** P10-B `tool_result.codeChange` is untyped on the wire. */
function asCodeChangeStats(raw: unknown): CodeChangeStats | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.additions !== 'number' || typeof rec.deletions !== 'number') {
    return undefined;
  }
  return rec as unknown as CodeChangeStats;
}

function argsRecordFromUnknown(args: unknown): Record<string, unknown> | undefined {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Parse-error content from the runner is `TOOL_ARGUMENTS_*` without an
 * `Error:` prefix, so `isToolResultFailure` would paint a success row.
 * `isError` on the event is the signal to force fail chrome.
 */
function displayToolResultContent(event: {
  content: string;
  isError?: boolean;
}): string {
  if (event.isError && !event.content.trimStart().startsWith('Error:')) {
    return `Error: ${event.content}`;
  }
  return event.content;
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
  // Args keyed the same way as wraps so a result can pass them to
  // `renderToolResult` / `attachShellKillUi` / the memory toast.
  const argsById = new Map<string, Record<string, unknown>>();
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

  /**
   * Origin-chat gate: `#chatArea` is shared, so a switch away would otherwise
   * append A's tools/tokens into B. Tests without `chatId` always paint.
   */
  const originStreamVisible = (): boolean => {
    if (host.isDomVisible) return host.isDomVisible();
    if (!host.chatId) return true;
    // Paint tests may set chatId for shell-kill without a session.
    if (!sessionState) return true;
    return isStreamDomVisible(host.chatId);
  };

  const bindToolStartIndicator = (): void => {
    toolStart?.dispose();
    toolStart = null;
    if (!lastStreamingToolName || !host.streamStatus) return;
    // Detached "Calling {tool}…" chrome is fine; do not attach onto B's row.
    if (!originStreamVisible()) return;
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

    const visible = originStreamVisible();

    if (thinkingSnap !== null) {
      const added = thinkingDeltaFromSnapshot(lastPaintedThinking, thinkingSnap);
      lastPaintedThinking = thinkingSnap;
      if (added && visible) host.thoughtController.appendReasoningDelta(added);
    }

    if (deltaSnap !== null) {
      if (!proseRevealed && deltaSnap.trim()) {
        proseRevealed = true;
        if (visible) {
          host.revealProse();
          revealAssistantProseBubble(host.wrap, host.bubble, host.streamStatus);
        }
      }
      if (visible) scheduleMarkdown(host.bubble, deltaSnap, host.cursor);
    }

    // One forced layout per tick covers thinking-only and prose streams.
    // P10-I: runChatTurn writes the context-ring overlay from this hook so
    // in-flight tokens are not counted per delta. Stats still fire when hidden.
    if (visible) scrollTranscript();
    host.onCoalescedPaint?.({ lastDelta, lastThinking, toolCallCount });
  };

  const schedulePaint = (): void => {
    if (paintScheduled) return;
    paintScheduled = true;
    schedulePaintTick(() => {
      flushPaint();
    });
  };

  /** Drop per-round snapshots so the next model round cannot prefix-diff against this one. */
  const resetRoundPaintState = (): void => {
    lastDelta = '';
    lastThinking = '';
    lastPaintedThinking = '';
    pendingDelta = null;
    pendingThinking = null;
    proseRevealed = false;
  };

  const applyHostPatch = (next: Partial<ChatTurnPaintHost>): void => {
    if (next.wrap) host.wrap = next.wrap;
    if (next.bubble) host.bubble = next.bubble;
    if (next.cursor) host.cursor = next.cursor;
    if (next.streamStatus) host.streamStatus = next.streamStatus;
    if (next.chatId !== undefined) host.chatId = next.chatId;
    if (next.isDomVisible) host.isDomVisible = next.isDomVisible;
    // Never retarget onto B's transcript while A is still the origin.
    if (next.mount && originStreamVisible()) host.mount = next.mount;
    if (next.thoughtController) host.thoughtController = next.thoughtController;
    if (next.revealProse) host.revealProse = next.revealProse;
    if (next.modeId !== undefined) host.modeId = next.modeId;
    if (next.finalizeThinkingRound) host.finalizeThinkingRound = next.finalizeThinkingRound;
    if (next.beginNextStreamingRow) host.beginNextStreamingRow = next.beginNextStreamingRow;
    if (next.onRoundFinalized) host.onRoundFinalized = next.onRoundFinalized;
    if (next.onCoalescedPaint) host.onCoalescedPaint = next.onCoalescedPaint;
    if (next.scrollTranscript) host.scrollTranscript = next.scrollTranscript;
    if (next.scheduleMarkdown) host.scheduleMarkdown = next.scheduleMarkdown;
  };

  const retarget = (next: Partial<ChatTurnPaintHost>): void => {
    applyHostPatch(next);
    // Apply queued snapshots onto the new shell before rebinding chrome.
    flushPaint();
    if (proseRevealed && lastDelta && next.bubble && originStreamVisible()) {
      scheduleMarkdown(next.bubble, lastDelta, next.cursor ?? host.cursor);
    }
    // Chat switch rebuilds the streaming shell; keep "Calling {tool}…" if args
    // are still streaming (MIN-2 leftover, now an overlay around runTurn).
    bindToolStartIndicator();
  };

  /**
   * loop.ts:2707–2745 — freeze this round's bubble, pin its thoughts toggle,
   * leave tool rows below it, then open a fresh streaming row for the next round.
   */
  const closeToolBearingRound = (event: Extract<TurnEvent, { type: 'round_end' }>): void => {
    flushPaint();
    const wrap = host.wrap;
    const bubble = host.bubble;
    const prose = event.text.trim() || lastDelta.trim();
    const hasProse = Boolean(prose);

    if (bubble) {
      cancelAssistantBubbleRenderDebounce(bubble);
      finishStreamingBubbleRender(bubble, host.cursor);
    }
    if (hasProse && bubble) {
      if (!proseRevealed) {
        proseRevealed = true;
        host.revealProse();
        revealAssistantProseBubble(wrap, bubble, host.streamStatus);
      }
      setAssistantBubbleContent(bubble, prose, { streaming: false, modeId: host.modeId });
    }

    const durationMs = host.finalizeThinkingRound?.() ?? 0;
    finalizeAndAnchorThinkingRound({
      thoughtController: host.thoughtController,
      wrap,
      streamStatus: host.streamStatus,
      hasProse,
      durationMs,
      domVisible: originStreamVisible(),
    });
    // Settled rows must not keep a live status handle; orphan/anchor already dispose.
    if (wrap.isConnected) host.streamStatus?.dispose();

    host.onRoundFinalized?.({
      wrap,
      text: prose,
      toolCallCount: event.toolCallCount,
      connected: wrap.isConnected,
    });

    // Reset before retarget so the new shell does not replay this round's prose.
    resetRoundPaintState();
    clearToolStartIndicator();

    const next = host.beginNextStreamingRow?.();
    if (next) retarget(next);
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
    if (event.type === 'reasoning_end') {
      // Flush first so the initial thinking delta can fire onThinkingStart
      // before endReasoningPhase runs onReasoningEnded (timer + Generating…).
      flushPaint();
      host.thoughtController.endReasoningPhase?.();
      return;
    }
    if (event.type === 'round_start') {
      // Belt-and-suspenders: a fresh cumulative snapshot must not prefix-diff
      // against the previous round if that round had no tools (no close).
      if (event.index > 0) {
        lastPaintedThinking = '';
        lastThinking = '';
        pendingThinking = null;
      }
      return;
    }
    if (event.type === 'round_end') {
      if (event.toolCallCount > 0) closeToolBearingRound(event);
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
      const parsed = parsePaintToolArguments(event.arguments);
      const wrap = renderToolCall(event.name, parsed.args);
      if (event.id) wrap.dataset.toolCallId = event.id;
      const key = event.id ?? `${event.name}:${toolCallCount}`;
      toolWraps.set(key, wrap);
      argsById.set(key, parsed.args);
      // Stop is wired on create so a long `execute_command` can be killed
      // before the result JSON arrives with the run id.
      if (event.id) {
        attachShellKillUi(
          wrap,
          event.name,
          event.id,
          parsed.args,
          undefined,
          host.chatId,
        );
      }
      // Same `#chatArea` node is reused after switchChat — skip while hidden.
      if (originStreamVisible()) host.mount.appendChild(wrap);
      return;
    }
    if (event.type === 'tool_result') {
      flushPaint();
      const key = event.id
        ? event.id
        : [...toolWraps.keys()].find((k) => k.startsWith(`${event.name}:`));
      const captured =
        (event.id && toolWraps.get(event.id)) || (key ? toolWraps.get(key) : undefined);
      if (!captured) return;
      // Re-query live DOM only while the origin chat is visible — otherwise a
      // matching toolCallId in B's transcript would take the result paint.
      const wrap =
        originStreamVisible() && event.id
          ? resolveLiveToolWrap(event.id, captured)
          : captured;
      if (wrap !== captured && event.id) {
        toolWraps.set(event.id, wrap);
      }
      const args =
        (event.id && argsById.get(event.id)) || (key ? argsById.get(key) : undefined);
      const content = displayToolResultContent(event);
      renderToolResult(
        wrap,
        content,
        asToolImageAttachments(event.attachments),
        args,
        asCodeChangeStats(event.codeChange),
      );
      if (event.id) {
        attachShellKillUi(
          wrap,
          event.name,
          event.id,
          argsRecordFromUnknown(args),
          content,
          host.chatId,
        );
      }
      notifyMemorySavedFromTool(event.name, args, content);
    }
  };

  return {
    onEvent,
    snapshot: () => ({ lastDelta, lastThinking, toolCallCount }),
    flush: flushPaint,
    retarget,
  };
}
