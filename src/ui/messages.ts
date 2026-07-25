import { isHubMounted, renderHub, refreshHubLiveData, teardownHub } from './hub';
import { isOrchestrateHubMounted, teardownOrchestrateHub } from './orchestrate-hub';
import { teardownCodeBrainMapBeforeChatPaint } from './code-brain-map';
import {
  isMainColumnOverlaySuppressingChatDom,
  stripMainColumnOverlayClasses,
} from './main-column-overlay';
import {
  getOrchestratePlanScreenSession,
  isOrchestratePlanScreenMounted,
  isOrchestratePlanScreenSessionActive,
  isOrchestratePlanScreenSuppressingChatDom,
  isOrchestratePlanScreenSuspendedForChat,
  removeOrchestratePlanScreenSuspendedBanner,
  restoreOrchestratePlanScreenSessionFromChat,
  showOrchestratePlanScreenSuspendedBanner,
  teardownOrchestratePlanScreen,
  teardownOrchestratePlanScreenDom,
} from './orchestrate-plan-screen';
import { extractInlineThinkingFromContent } from '../api/inline-thinking';
import { normalizeModeId } from '../chat/modes/types';
import { isHiddenTranscriptUserMessage } from '../chat/hidden-transcript-user-messages';
import { resolveModelInfo, showCachedModelInfo } from '../api/models';
import { isActiveChatStreaming, isChatStreaming, isStreamDomVisible } from '../chat/streaming-state';
import { setAssistantBubbleContent } from '../markdown/renderer';
import { getActiveBoardGroup } from '../state/chat-groups';
import {
  clearActiveGoal,
  clearActiveLoops,
  clearChatTodos,
  getActiveChat,
  touchChat,
  scheduleSaveSessions,
} from '../state/sessions';
import type {
  AssistantToolCallMessage,
  AssistantMessage,
  Chat,
  Message,
  ModelInfo,
  Stats,
  ToolResultMessage,
  Usage,
} from '../types';
import {
  captureChatScrollAnchor,
  restoreChatScrollAnchor,
  scrollChatIfPinned,
  scrollChatToBottom,
} from './chat-scroll';
import {
  getActiveChatMountElement,
  isChatAppForeground,
  isCodeChatMount,
  resolveChatMount,
  runWithChatMount,
  shouldPaintDesktopChatSurface,
} from './chat-mount';
import { isBoardViewActive } from './view-mode-toggle';
import { closeDrawer } from './settings';
import { setStatus } from './status';
import { refreshMetricsStripForChat } from '../chat/orchestrate/board-stats-aggregate';
import { refreshContextUsageRing } from './context-usage-ring';
import { resetCodeChangeTotals, recomputeWorkspaceCodeChangeTotals } from '../usage/code-change-ledger';
import { sessionState } from '../state/sessions';
import { updateWorkspaceCodeChangeDisplay } from './workspace-code-change';
import { resetTokenLedger } from '../usage/token-ledger';
import { updateCodeChangeStrip } from './code-change-strip';
import { renderSidebar } from './sidebar';
import { syncTodoPanel } from './todo-panel';
import { renderThoughtsToggle } from './thought-bubbles';
import { renderToolCall, renderToolResult } from './tool-messages';
import { attachShellKillUi } from './shell-run-ui';
import { markMessageStopped } from './stopped-affordance';
import { markMessageSteered } from './steer-affordance';
import { restoreGoalAchievedAffordance } from './goal-affordance';
import {
  clearSubAgentCardDomRegistry,
  renderPersistedSubAgentCardsForChat,
} from './sub-agent-cards';
import {
  attachStreamStatus,
  type StreamingStatusHandle,
  type StreamPhase,
} from './stream-status';
import {
  attachMessageActions,
  type MessageTurnKind,
} from './message-actions';
import { attachVoicePlayButton } from './voice-controls';
import { attachBranchPicker } from './branch-picker';
import {
  renderUserMessageBubble,
  type UserBubbleRenderOptions,
} from './user-message-bubble';
import { getBeforeAfterPairs } from '../design/before-after-integration';
import { renderBeforeAfterCard } from '../design/before-after-card';

/** Parse stored tool `arguments` JSON for display in the args <details> block. */
function parseToolArgsForDisplay(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function isAssistantToolCallMessage(msg: Message): msg is AssistantToolCallMessage {
  return (
    msg.role === 'assistant' &&
    'tool_calls' in msg &&
    Array.isArray((msg as AssistantToolCallMessage).tool_calls) &&
    (msg as AssistantToolCallMessage).tool_calls.length > 0
  );
}

export { resolveModelInfo, showCachedModelInfo } from '../api/models';

/** Suppress per-bubble scroll while bulk-rendering history (renderChatFromHistory). */
let suppressBubbleScroll = false;

export function renderStatsForChat(chat: Chat): void {
  refreshMetricsStripForChat(chat);
  refreshContextUsageRing();
  if (isHubMounted()) refreshHubLiveData();
}

export function renderChatFromHistory(chat: Chat, mount?: string | HTMLElement): void {
  const area = resolveChatMount(mount);
  const codeMount = isCodeChatMount(mount);
  const scrollAnchor = captureChatScrollAnchor();

  // Code overview / code map own #chatArea — do not repaint chat or board underneath.
  if (codeMount && isMainColumnOverlaySuppressingChatDom()) {
    return;
  }

  runWithChatMount(area, () => {
  suppressBubbleScroll = true;
  try {
  if (codeMount) {
    teardownCodeBrainMapBeforeChatPaint();
    stripMainColumnOverlayClasses();
  }
  updateCodeChangeStrip(chat);
  if (codeMount && isOrchestrateHubMounted()) {
    teardownOrchestrateHub();
  }
  if (codeMount) {
    restoreOrchestratePlanScreenSessionFromChat(chat);
  }
  // Suspended plan session: keep the resume banner but still render the
  // transcript beneath it (a banner-only page reads as a blank/lost chat).
  const suspendedPlanChat = codeMount && isOrchestratePlanScreenSuspendedForChat(chat);
  if (suspendedPlanChat) {
    teardownHub();
    if (!chat.history.length) {
      area.innerHTML = '';
      showOrchestratePlanScreenSuspendedBanner(area, chat);
      renderPersistedSubAgentCardsForChat(chat);
      refreshContextUsageRing();
      return;
    }
  } else if (codeMount && !isOrchestratePlanScreenSessionActive(chat)) {
    // Another chat may be foreground while Super Plan grill questions stay parked
    // in the composer for the planning chat — do not cancel that session.
    const foreignSuspendedPlan = (() => {
      const session = getOrchestratePlanScreenSession();
      return Boolean(
        session?.planScreenSuspended && session.chatId !== chat.id,
      );
    })();
    if (!foreignSuspendedPlan) {
      teardownOrchestratePlanScreen();
    } else {
      // Banner is pinned on .chat-viewport (not #chatArea) — clear it when foregrounding
      // another chat while a Super Plan session stays suspended in the background.
      removeOrchestratePlanScreenSuspendedBanner();
    }
  } else if (codeMount && isOrchestratePlanScreenMounted()) {
    teardownOrchestratePlanScreenDom();
  }
  const boardGroup = codeMount ? getActiveBoardGroup() : null;
  if (boardGroup?.viewMode === 'board') {
    teardownHub();
    void import('./orchestrate-board-setup-banner').then((m) => m.removeBoardSetupReturnBanner());
    void import('./orchestrate-board').then((m) => {
      m.renderBoardView(boardGroup);
      m.refreshActiveBoardIfMounted();
    });
    return;
  }
  void import('./orchestrate-board-setup-banner').then((m) => m.syncBoardSetupReturnBanner(chat));
  clearSubAgentCardDomRegistry();
  if (!chat.history.length) {
    if (codeMount) {
      renderHub(chat);
      renderPersistedSubAgentCardsForChat(chat);
    } else {
      area.innerHTML = '';
      renderPersistedSubAgentCardsForChat(chat);
    }
    scrollChatToBottom();
    refreshContextUsageRing();
    return;
  }
  if (codeMount) {
    teardownHub();
  }
  area.innerHTML = '';
  if (suspendedPlanChat) {
    showOrchestratePlanScreenSuspendedBanner(area, chat);
  }
  const toolResultMap = new Map<
    string,
    {
      content: string;
      attachments?: ToolResultMessage['attachments'];
      codeChange?: ToolResultMessage['codeChange'];
    }
  >();
  for (const msg of chat.history) {
    if (msg?.role !== 'tool') continue;
    const toolMsg = msg as ToolResultMessage;
    toolResultMap.set(toolMsg.tool_call_id, {
      content: toolMsg.content,
      attachments: toolMsg.attachments,
      ...(toolMsg.codeChange ? { codeChange: toolMsg.codeChange } : {}),
    });
  }

  for (let i = 0; i < chat.history.length; i += 1) {
    const msg = chat.history[i];
    if (!msg || !msg.role) continue;
    if (msg.role === 'tool') continue;

    if (msg.role === 'user') {
      const userMsg = msg;
      if (isHiddenTranscriptUserMessage(userMsg)) {
        continue;
      }
      const { wrap } = appendBubble('user', userMsg.content, {
        historyIndex: i,
        turnKind: 'user',
        chatId: chat.id,
        modeId: chat.modeId,
      }, { renderFromHistory: true });
      if (userMsg.steer) {
        markMessageSteered(wrap);
      }
      if (userMsg.goalAchieved) {
        restoreGoalAchievedAffordance(wrap, userMsg);
      }
      attachMessageActions(wrap, {
        chatId: chat.id,
        historyIndex: i,
        turnKind: 'user',
      });
      attachBranchPicker(wrap, chat.id, i);
      continue;
    }

    if (isAssistantToolCallMessage(msg)) {
      const prose = msg.content != null ? String(msg.content).trim() : '';
      const toolThinking =
        msg.thinking != null && msg.thinking.length > 0 ? msg.thinking : undefined;
      const hasToolThinking = toolThinking != null && toolThinking.length > 0;
      if (prose || hasToolThinking) {
        const { wrap, bubble } = appendBubble('assistant', prose, {
          historyIndex: i,
          turnKind: 'assistant-tools',
          chatId: chat.id,
          modeId: chat.modeId,
        });
        if (!prose && hasToolThinking) {
          bubble.remove();
        }
        if (hasToolThinking) {
          const durationMs = msg.thinkingDurationMs;
          renderThoughtsToggle(wrap, toolThinking!, {
            durationMs: durationMs != null && durationMs > 0 ? durationMs : undefined,
          });
        }
        if (msg.stats || msg.usage) {
          appendStats(wrap, msg.stats || {}, msg.usage || {});
        }
        attachMessageActions(wrap, {
          chatId: chat.id,
          historyIndex: i,
          turnKind: 'assistant-tools',
        });
      }

      let firstToolEl: HTMLElement | null = null;
      for (const tc of msg.tool_calls) {
        const argsObj = parseToolArgsForDisplay(tc.function.arguments);
        const toolWrap = renderToolCall(tc.function.name, argsObj);
        toolWrap.dataset.toolCallId = tc.id;
        toolWrap.dataset.historyIndex = String(i);
        toolWrap.dataset.turnKind = 'assistant-tools';
        area.appendChild(toolWrap);
        if (!firstToolEl) firstToolEl = toolWrap;
        const stored = toolResultMap.get(tc.id);
        if (stored !== undefined) {
          renderToolResult(
            toolWrap,
            stored.content,
            stored.attachments,
            argsObj,
            stored.codeChange,
          );
        }
        attachShellKillUi(toolWrap, tc.function.name, tc.id, argsObj, undefined, chat.id);
      }
      if (!prose && !hasToolThinking && firstToolEl) {
        attachMessageActions(firstToolEl, {
          chatId: chat.id,
          historyIndex: i,
          turnKind: 'assistant-tools',
        });
      }

      // Before/after diff card (MIN-370 P1): mount under the turn whose file save(s) produced it.
      for (const pair of getBeforeAfterPairs(chat.id)) {
        if (pair.turnId !== String(i)) continue;
        area.appendChild(renderBeforeAfterCard(pair));
      }
      continue;
    }

    const text = msg.content ?? '';
    let trimmed = text.trim();
    const withThinking = msg as AssistantMessage;
    let thinkingSegments =
      withThinking.thinking != null && withThinking.thinking.length > 0
        ? withThinking.thinking
        : undefined;
    // Repair already-saved sessions where thinking leaked into `content` without `thinking`.
    if (!thinkingSegments?.length && trimmed) {
      const split = extractInlineThinkingFromContent(text);
      if (split.thinking.length > 0 && split.reply.trim()) {
        trimmed = split.reply.trim();
        thinkingSegments = split.thinking;
      }
    }
    const hasThinking = thinkingSegments != null && thinkingSegments.length > 0;
    if (!trimmed && !hasThinking) {
      continue;
    }
    const { wrap } = appendBubble('assistant', trimmed, {
      historyIndex: i,
      turnKind: 'assistant',
      chatId: chat.id,
      modeId: chat.modeId,
    });
    if (hasThinking) {
      const durationMs = withThinking.thinkingDurationMs;
      renderThoughtsToggle(wrap, thinkingSegments!, {
        durationMs: durationMs != null && durationMs > 0 ? durationMs : undefined,
      });
    }
    if (withThinking.stopped) {
      markMessageStopped(wrap);
    }
    if (msg.stats || msg.usage) {
      appendStats(wrap, msg.stats || {}, msg.usage || {});
    }
    attachMessageActions(wrap, {
      chatId: chat.id,
      historyIndex: i,
      turnKind: 'assistant',
    });
    attachVoicePlayButton(wrap, trimmed);
  }
  renderPersistedSubAgentCardsForChat(chat);
  restoreChatScrollAnchor(scrollAnchor);
  refreshContextUsageRing();
  if (isChatStreaming(chat.id) && isStreamDomVisible(chat.id)) {
    // Lazy import breaks a circular dependency with stream-chat-dom.ts (appendStreamingAssistantRow).
    void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chat.id));
  }
  } finally {
    suppressBubbleScroll = false;
    void import('./loop-active-hint').then(({ syncLoopStatusUi }) => {
      syncLoopStatusUi(chat.id);
    });
  }
  });
}

/** Re-render the chat transcript in whichever shell is currently foreground. */
export function renderChatInForegroundShell(chat: Chat): void {
  if (shouldPaintDesktopChatSurface()) {
    void import('../os/desktop-chat').then((m) => m.activateDesktopChatSession(chat.id));
    return;
  }
  if (isChatAppForeground()) {
    renderChatFromHistory(chat, '#chatAppMessageCol');
    return;
  }
  renderChatFromHistory(chat);
}

/** Optional history index for message action menus. */
export interface BubbleRenderMeta {
  historyIndex: number;
  turnKind: MessageTurnKind;
  chatId: string;
  /** Mode of the chat when the bubble was rendered (passed to markdown renderer). */
  modeId?: string;
}

export interface AppendUserBubbleOptions extends UserBubbleRenderOptions {
  /** When true, paint chips from persisted history content (default for user rows). */
  renderFromHistory?: boolean;
}

/** True when board view should suppress chat bubbles (user can jump to Chat view). */
function shouldStubOrchestrateBoardStreamDom(_chat: Chat): boolean {
  return isBoardViewActive();
}

/** True when plan authoring screen suppresses chat bubble DOM. */
function shouldStubOrchestratePlanScreenStreamDom(chat: Chat): boolean {
  const modeId = normalizeModeId(chat.modeId);
  if (modeId !== 'plan' && modeId !== 'super-plan' && modeId !== 'orchestrate') {
    return false;
  }
  return isOrchestratePlanScreenSuppressingChatDom(chat.id);
}

function shouldStubOrchestrateStreamDom(chat: Chat): boolean {
  return (
    shouldStubOrchestrateBoardStreamDom(chat) ||
    shouldStubOrchestratePlanScreenStreamDom(chat)
  );
}

function resolveBubbleTargetChat(meta?: BubbleRenderMeta): Chat {
  const active = getActiveChat();
  const targetId = meta?.chatId?.trim();
  if (!targetId || targetId === active.id) return active;
  return sessionState?.chats.find((c) => c.id === targetId) ?? active;
}

function bubbleDomStub(): { wrap: HTMLDivElement; bubble: HTMLDivElement } {
  const stub = document.createElement('div');
  return { wrap: stub, bubble: stub };
}

export function appendBubble(
  role: 'user' | 'assistant',
  content: string,
  meta?: BubbleRenderMeta,
  userOptions?: AppendUserBubbleOptions,
): { wrap: HTMLDivElement; bubble: HTMLDivElement } {
  const active = getActiveChat();
  const targetId = meta?.chatId?.trim() || active.id;
  if (targetId !== active.id && !isStreamDomVisible(targetId)) {
    return bubbleDomStub();
  }
  const chat = resolveBubbleTargetChat(meta);
  if (shouldStubOrchestrateStreamDom(chat)) {
    return bubbleDomStub();
  }
  if (document.getElementById('emptyState')) {
    document.getElementById('emptyState')!.remove();
  }
  if (isHubMounted()) {
    teardownHub();
  }

  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if (meta) {
    wrap.dataset.historyIndex = String(meta.historyIndex);
    wrap.dataset.turnKind = meta.turnKind;
    wrap.dataset.chatId = meta.chatId;
  }

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'Assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (role === 'assistant') {
    setAssistantBubbleContent(bubble, content, {
      streaming: false,
      modeId: meta?.modeId ?? chat.modeId,
    });
  } else if (userOptions?.renderFromHistory !== false) {
    renderUserMessageBubble(bubble, content, userOptions);
    bubble.dataset.historyContent = content;
  } else {
    bubble.textContent = content;
  }

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  getActiveChatMountElement().appendChild(wrap);
  if (!suppressBubbleScroll) {
    if (role === 'user') {
      scrollChatToBottom();
    } else {
      scrollChatIfPinned();
    }
  }
  return { wrap, bubble };
}

/** Inline assistant failure copy (network, provider, or lost generation). */
export function setAssistantErrorBubble(bubble: HTMLDivElement, message: string): void {
  bubble.classList.remove('msg-bubble--md', 'msg-bubble--awaiting');
  bubble.classList.add('msg-bubble--error');
  bubble.replaceChildren();
  bubble.textContent = message;
}

export interface AssistantErrorRecoveryOptions {
  chatId: string;
  forkHistoryIndex: number;
  onRecover?: () => void;
}

/**
 * Error bubble with a recovery action when history could not be auto-rolled back.
 * Clears the failed tail and replays from the user message at `forkHistoryIndex`.
 */
export function setAssistantErrorBubbleWithRecovery(
  bubble: HTMLDivElement,
  message: string,
  recovery: AssistantErrorRecoveryOptions,
): void {
  bubble.classList.remove('msg-bubble--md', 'msg-bubble--awaiting');
  bubble.classList.add('msg-bubble--error');
  bubble.replaceChildren();

  const text = document.createElement('span');
  text.textContent = message;
  bubble.appendChild(text);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'msg-error-recover-btn';
  action.textContent = 'Clear last failed turn';
  action.addEventListener('click', () => {
    action.disabled = true;
    void import('../chat/resend-from-index.ts').then((mod) =>
      mod.resendFromIndex(recovery.chatId, recovery.forkHistoryIndex),
    );
    recovery.onRecover?.();
  });
  bubble.appendChild(action);
}

/** DOM row for an in-flight assistant reply (prose bubble hidden until first token). */
export interface StreamingAssistantRow {
  wrap: HTMLDivElement;
  bubble: HTMLDivElement;
  cursor: HTMLDivElement;
  streamStatus: StreamingStatusHandle;
}

/** Update the live stream phase label on an in-flight assistant row. */
export function setStreamingRowPhase(wrap: HTMLElement, phase: StreamPhase): void {
  const phaseAttr = wrap.dataset.streamPhase;
  if (!phaseAttr) return;
  const status = wrap.querySelector('.stream-status');
  if (!status) return;
  const label = status.querySelector('.stream-status__label');
  if (phase === 'prose' || phase === 'done') {
    status.classList.add('hidden');
    status.setAttribute('aria-busy', 'false');
    wrap.dataset.streamPhase = phase;
    return;
  }
  status.classList.remove('hidden');
  status.setAttribute('aria-busy', 'true');
  status.classList.remove('stream-status--generating', 'stream-status--thinking');
  status.classList.add(
    phase === 'thinking' ? 'stream-status--thinking' : 'stream-status--generating',
  );
  if (label) {
    label.textContent =
      phase === 'thinking' ? 'Thinking…' : 'Generating response…';
  }
  wrap.dataset.streamPhase = phase;
}

/**
 * Create an assistant message shell for SSE streaming without showing an empty bubble.
 * Thought bubbles attach to `wrap`; call {@link revealAssistantProseBubble} on first prose delta.
 */
/** Stub row when the stream targets a chat that is not visible in #chatArea. */
function streamingAssistantRowStub(): StreamingAssistantRow {
  const stub = document.createElement('div');
  const bubble = document.createElement('div');
  const cursor = document.createElement('div');
  return {
    wrap: stub,
    bubble,
    cursor,
    streamStatus: {
      setPhase: () => {},
      setThinkingElapsed: () => {},
      dispose: () => {},
    },
  };
}

/** Drop orphaned in-flight assistant shells before mounting a fresh stream row. */
function removeStaleLiveStreamingRows(mount: HTMLElement): void {
  for (const row of mount.querySelectorAll('.msg.assistant.msg--awaiting-prose')) {
    row.remove();
  }
}

export function appendStreamingAssistantRow(forChatId?: string): StreamingAssistantRow {
  const active = getActiveChat();
  const targetId = forChatId ?? active.id;
  if (!isStreamDomVisible(targetId)) {
    return streamingAssistantRowStub();
  }
  const targetChat =
    targetId === active.id
      ? active
      : sessionState?.chats.find((c) => c.id === targetId) ?? active;
  if (shouldStubOrchestrateStreamDom(targetChat)) {
    return streamingAssistantRowStub();
  }
  if (document.getElementById('emptyState')) {
    document.getElementById('emptyState')!.remove();
  }
  if (isHubMounted()) {
    teardownHub();
  }

  const mount = getActiveChatMountElement();
  removeStaleLiveStreamingRows(mount);

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant msg--awaiting-prose';

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = 'Assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--awaiting';

  const cursor = document.createElement('div');
  cursor.className = 'cursor cursor--prose';
  cursor.setAttribute('aria-hidden', 'true');

  wrap.appendChild(label);
  const streamStatus = attachStreamStatus(wrap);
  wrap.appendChild(bubble);
  bubble.appendChild(cursor);
  mount.appendChild(wrap);
  // Respect scroll pin: only follow the tail when the user is already near bottom.
  scrollChatIfPinned();
  return { wrap, bubble, cursor, streamStatus };
}

/** Show the assistant prose bubble once streamed content (or fallback text) is ready. */
export function revealAssistantProseBubble(
  wrap: HTMLElement,
  bubble: HTMLElement,
  streamStatus?: StreamingStatusHandle,
): void {
  wrap.classList.remove('msg--awaiting-prose');
  bubble.classList.remove('msg-bubble--awaiting');
  streamStatus?.setPhase('prose');
}

/** True when assistant prose should be painted (non-whitespace or persisted thoughts). */
export function assistantProseHasVisibleContent(
  content: string | null | undefined,
  hasThinking = false,
): boolean {
  const trimmed = content != null ? String(content).trim() : '';
  return trimmed.length > 0 || hasThinking;
}

/**
 * Remove a live streaming assistant shell that would show an empty bubble
 * (tool-only turns, cancelled streams, or turn end with no prose).
 */
export function removeOrphanStreamingRow(
  wrap: HTMLElement,
  streamStatus?: StreamingStatusHandle,
): void {
  streamStatus?.dispose();
  if (wrap.isConnected) {
    wrap.remove();
  }
}

export interface AnchorPersistedThoughtsOptions {
  durationMs?: number;
  streamStatus?: StreamingStatusHandle;
}

/**
 * Pin a completed thinking block on an assistant row at the response that produced it.
 * When there is no prose, drops the empty streaming bubble and status chrome.
 */
export function anchorPersistedThoughtsOnRow(
  wrap: HTMLElement,
  segments: string[],
  opts: AnchorPersistedThoughtsOptions = {},
): void {
  if (segments.length === 0) return;
  renderThoughtsToggle(wrap, segments, {
    durationMs: opts.durationMs != null && opts.durationMs > 0 ? opts.durationMs : undefined,
  });
  opts.streamStatus?.dispose();
  wrap.querySelector('.msg-bubble')?.remove();
  wrap.querySelector('.stream-status')?.remove();
  wrap.classList.remove('msg--awaiting-prose');
}

/** Add per-turn metric chips under an assistant bubble. */
export function appendStats(
  wrap: HTMLElement,
  stats: Stats | undefined,
  usage: Usage | undefined
): void {
  const s = stats || {};
  const u = usage || {};

  const chips = document.createElement('div');
  chips.className = 'msg-stats';

  const defs: [string, boolean, string][] = [
    ['c', s.tokens_per_second != null, `<span>${s.tokens_per_second?.toFixed(1)}</span> tok/s`],
    ['g', s.time_to_first_token != null, `TTFT <span>${s.time_to_first_token?.toFixed(3)}s</span>`],
    ['y', s.generation_time != null, `gen <span>${s.generation_time?.toFixed(3)}s</span>`],
    ['r', u.total_tokens != null, `<span>${u.total_tokens}</span> tokens`],
  ];

  for (const [cls, show, html] of defs) {
    if (!show) continue;
    const chip = document.createElement('div');
    chip.className = `stat-chip ${cls}`;
    chip.innerHTML = html;
    chips.appendChild(chip);
  }

  if (chips.children.length) wrap.appendChild(chips);
}

/** Clear the active chat's message history (session row remains). */
export function clearChat(): void {
  if (isActiveChatStreaming()) {
    setStatus('spin', 'Finish the current reply first');
    return;
  }
  if (!confirm('Clear all messages in this chat? The chat stays in your sidebar.')) return;
  const chat = getActiveChat();
  clearActiveGoal(chat);
  clearActiveLoops(chat);
  clearChatTodos(chat);
  chat.history = [];
  resetTokenLedger(chat);
  resetCodeChangeTotals(chat);
  updateCodeChangeStrip(chat);
  if (sessionState) {
    recomputeWorkspaceCodeChangeTotals(sessionState, chat.workspacePath);
    updateWorkspaceCodeChangeDisplay();
  }
  chat.lastStats = null;
  chat.modelInfo = {};
  chat.lastMessageAt = 0;
  touchChat(chat);
  renderChatFromHistory(chat);
  renderStatsForChat(chat);
  renderSidebar();
  scheduleSaveSessions();
  syncTodoPanel();
  void import('./loop-active-hint').then(({ syncLoopActiveHint }) => {
    syncLoopActiveHint();
  });
  void import('./goal-active-hint').then(({ syncGoalActiveHint }) => {
    syncGoalActiveHint();
  });
  closeDrawer();
}
