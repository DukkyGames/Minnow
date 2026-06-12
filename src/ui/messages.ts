import { isHubMounted, renderHub, refreshHubLiveData, teardownHub } from './hub';
import { isOrchestrateHubMounted, teardownOrchestrateHub } from './orchestrate-hub';
import {
  isOrchestratePlanScreenMounted,
  isOrchestratePlanScreenSessionActive,
  isOrchestratePlanScreenSuppressingChatDom,
  isOrchestratePlanScreenSuspendedForChat,
  showOrchestratePlanScreenSuspendedBanner,
  teardownOrchestratePlanScreen,
  teardownOrchestratePlanScreenDom,
} from './orchestrate-plan-screen';
import { normalizeModeId } from '../chat/modes/types';
import { resolveModelInfo, showCachedModelInfo } from '../api/models';
import { isActiveChatStreaming, isStreamDomVisible } from '../chat/streaming-state';
import { setAssistantBubbleContent } from '../markdown/renderer';
import { getActiveBoardGroup } from '../state/chat-groups';
import {
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
  pinChatScroll,
  scrollChatIfPinned,
  scrollChatToBottom,
} from './chat-scroll';
import {
  getActiveChatMountElement,
  isCodeChatMount,
  resolveChatMount,
  runWithChatMount,
} from './chat-mount';
import { isOrchestrateBoardInitSplitActive } from './orchestrate-board-init-split';
import { isBoardViewActive } from './view-mode-toggle';
import { closeDrawer } from './settings';
import { setStatus } from './status';
import { updateStrip } from './stats';
import { refreshContextUsageRing } from './context-usage-ring';
import { resetCodeChangeTotals, recomputeWorkspaceCodeChangeTotals } from '../usage/code-change-ledger';
import { sessionState } from '../state/sessions';
import { updateWorkspaceCodeChangeDisplay } from './workspace-code-change';
import { resetTokenLedger } from '../usage/token-ledger';
import { updateCodeChangeStrip } from './code-change-strip';
import { renderSidebar } from './sidebar';
import { renderThoughtsToggle } from './thought-bubbles';
import { renderToolCall, renderToolResult } from './tool-messages';
import { markMessageStopped } from './stopped-affordance';
import { markMessageSteered } from './steer-affordance';
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
import { attachBranchPicker } from './branch-picker';
import {
  renderUserMessageBubble,
  type UserBubbleRenderOptions,
} from './user-message-bubble';

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

export function renderStatsForChat(chat: Chat): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const mid = (sel && sel.value) || chat.modelId || '';
  const ls = chat.lastStats;
  const hasNumeric =
    ls &&
    (ls.tokens_per_second != null ||
      ls.time_to_first_token != null ||
      ls.generation_time != null ||
      ls.total_tokens != null);
  if (hasNumeric) {
    const stats: Stats = {
      tokens_per_second: ls!.tokens_per_second ?? undefined,
      time_to_first_token: ls!.time_to_first_token ?? undefined,
      generation_time: ls!.generation_time ?? undefined,
      stop_reason: ls!.stop_reason ?? undefined,
    };
    const usage: Usage = {
      total_tokens: ls!.total_tokens ?? undefined,
      prompt_tokens: ls!.prompt_tokens ?? undefined,
      completion_tokens: ls!.completion_tokens ?? undefined,
    };
    updateStrip(stats, usage, resolveModelInfo(mid, chat.modelInfo || {}));
  } else {
    updateStrip({}, {}, resolveModelInfo(mid, chat.modelInfo || {}));
  }
  refreshContextUsageRing();
  if (isHubMounted()) refreshHubLiveData();
}

export function renderChatFromHistory(chat: Chat, mount?: string | HTMLElement): void {
  const area = resolveChatMount(mount);
  const codeMount = isCodeChatMount(mount);

  runWithChatMount(area, () => {
  updateCodeChangeStrip(chat);
  if (codeMount && isOrchestrateHubMounted()) {
    teardownOrchestrateHub();
  }
  if (codeMount && isOrchestratePlanScreenSuspendedForChat(chat)) {
    teardownHub();
    area.innerHTML = '';
    showOrchestratePlanScreenSuspendedBanner(area, chat);
    renderPersistedSubAgentCardsForChat(chat);
    refreshContextUsageRing();
    return;
  }
  if (codeMount && !isOrchestratePlanScreenSessionActive(chat)) {
    teardownOrchestratePlanScreen();
  } else if (codeMount && isOrchestratePlanScreenMounted()) {
    teardownOrchestratePlanScreenDom();
  }
  const boardGroup = codeMount ? getActiveBoardGroup() : null;
  if (boardGroup?.viewMode === 'board') {
    teardownHub();
    void import('./orchestrate-board').then((m) => {
      m.renderBoardView(boardGroup);
      m.refreshActiveBoardIfMounted();
    });
    return;
  }
  clearSubAgentCardDomRegistry();
  if (!chat.history.length) {
    if (codeMount) {
      renderHub(chat);
      renderPersistedSubAgentCardsForChat(chat);
    } else {
      area.innerHTML = '';
    }
    scrollChatToBottom();
    refreshContextUsageRing();
    return;
  }
  if (codeMount) {
    teardownHub();
  }
  area.innerHTML = '';
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
      const { wrap } = appendBubble('user', userMsg.content, {
        historyIndex: i,
        turnKind: 'user',
        chatId: chat.id,
        modeId: chat.modeId,
      }, { renderFromHistory: true });
      if (userMsg.steer) {
        markMessageSteered(wrap);
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
      if (prose) {
        const { wrap } = appendBubble('assistant', prose, {
          historyIndex: i,
          turnKind: 'assistant-tools',
          chatId: chat.id,
          modeId: chat.modeId,
        });
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
      }
      if (!prose && firstToolEl) {
        attachMessageActions(firstToolEl, {
          chatId: chat.id,
          historyIndex: i,
          turnKind: 'assistant-tools',
        });
      }
      continue;
    }

    const text = msg.content ?? '';
    const trimmed = text.trim();
    const withThinking = msg as AssistantMessage;
    const hasThinking =
      withThinking.thinking != null && withThinking.thinking.length > 0;
    if (!trimmed && !hasThinking) {
      continue;
    }
    const { wrap } = appendBubble('assistant', trimmed, {
      historyIndex: i,
      turnKind: 'assistant',
      chatId: chat.id,
      modeId: chat.modeId,
    });
    if (withThinking.thinking && withThinking.thinking.length > 0) {
      const durationMs = withThinking.thinkingDurationMs;
      renderThoughtsToggle(wrap, withThinking.thinking, {
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
  }
  renderPersistedSubAgentCardsForChat(chat);
  scrollChatToBottom();
  refreshContextUsageRing();
  });
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

/** True when board view should suppress chat bubbles (full board, no init split). */
function shouldStubOrchestrateBoardStreamDom(chat: Chat): boolean {
  if (!isBoardViewActive()) return false;
  if (
    normalizeModeId(chat.modeId) === 'orchestrate' &&
    isOrchestrateBoardInitSplitActive(chat)
  ) {
    return false;
  }
  return true;
}

/** True when plan authoring screen suppresses chat bubble DOM. */
function shouldStubOrchestratePlanScreenStreamDom(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'plan' && normalizeModeId(chat.modeId) !== 'orchestrate') {
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

export function appendBubble(
  role: 'user' | 'assistant',
  content: string,
  meta?: BubbleRenderMeta,
  userOptions?: AppendUserBubbleOptions,
): { wrap: HTMLDivElement; bubble: HTMLDivElement } {
  const chat = getActiveChat();
  if (shouldStubOrchestrateStreamDom(chat)) {
    const stub = document.createElement('div');
    return { wrap: stub, bubble: stub };
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
  if (role === 'user') {
    scrollChatToBottom();
  } else {
    scrollChatIfPinned();
  }
  return { wrap, bubble };
}

/** Inline assistant failure copy (network, provider, or lost generation). */
export function setAssistantErrorBubble(bubble: HTMLDivElement, message: string): void {
  bubble.classList.remove('msg-bubble--md', 'msg-bubble--awaiting');
  bubble.classList.add('msg-bubble--error');
  bubble.textContent = message;
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

export function appendStreamingAssistantRow(forChatId?: string): StreamingAssistantRow {
  const chat = getActiveChat();
  const targetId = forChatId ?? chat.id;
  if (!isStreamDomVisible(targetId)) {
    return streamingAssistantRowStub();
  }
  if (shouldStubOrchestrateStreamDom(chat)) {
    return streamingAssistantRowStub();
  }
  if (document.getElementById('emptyState')) {
    document.getElementById('emptyState')!.remove();
  }
  if (isHubMounted()) {
    teardownHub();
  }

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
  getActiveChatMountElement().appendChild(wrap);
  pinChatScroll();
  scrollChatToBottom();
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
  closeDrawer();
}
