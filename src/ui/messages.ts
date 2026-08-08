import { isHubMounted, renderHub, refreshHubLiveData, teardownHub } from './hub';
import { isOrchestrateHubMounted, teardownOrchestrateHub } from './orchestrate-hub';
import { teardownCodeBrainMapBeforeChatPaint } from './code-brain-map';
import { teardownIssuesEmbedBeforeChatPaint } from './issues-page';
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
  isSuperPlanScreenMountedForOtherChat,
  isSuperPlanScreenShowingChat,
  removeOrchestratePlanScreenSuspendedBanner,
  reopenSuperPlanScreenForChat,
  restoreOrchestratePlanScreenSessionFromChat,
  showOrchestratePlanScreenSuspendedBanner,
  teardownOrchestratePlanScreen,
  teardownOrchestratePlanScreenDom,
} from './orchestrate-plan-screen';
import { extractInlineThinkingFromContent } from '../api/inline-thinking';
import { normalizeModeId } from '../chat/modes/types';
import { isHiddenTranscriptUserMessage } from '../chat/hidden-transcript-user-messages';
import {
  contextNoticeAction,
  contextNoticeOutcome,
} from '../chat/context/context-notice';
import {
  injectionNoticeAction,
  injectionNoticeOutcome,
} from '../chat/context/injection-notice';
import type {
  ContextNoticeMessage,
  InjectionNoticeMessage,
  PromptInjectionKind,
} from '../types';
import { createIcon, type IconName } from './icon';
import { resolveModelInfo, showCachedModelInfo } from '../api/models';
import { isActiveChatStreaming, isChatStreaming, isStreamDomVisible } from '../chat/streaming-state';
import { setAssistantBubbleContent } from '../markdown/renderer';
import {
  getActiveBoardGroup,
  getBoardGroupForChat,
  isBoardOwnedChat,
} from '../state/chat-groups';
import {
  isBoardChatEmbedOpenForChat,
  queryBoardChatTranscriptHost,
} from './orchestrate-board-chat-state';
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
import { dismissCodeOverviewForNavigation } from './code-overview';
import { dismissDevServerScreenForNavigation } from './dev-server-screen';
import { isBoardViewActive } from './view-mode-toggle';
import { closeDrawer } from './settings';
import { appConfirm } from './app-dialog';
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
  beginStreamAnnouncer,
  cancelStreamAnnouncer,
  completeStreamAnnouncer,
} from './a11y/stream-announcer';
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

/** Remove landing placeholders before the first live bubble mounts. */
function clearTranscriptEmptyState(mount: HTMLElement): void {
  document.getElementById('emptyState')?.remove();
  for (const el of mount.querySelectorAll(
    '.mn-os-chat-empty, .chat-app-empty, .chat-history-pending',
  )) {
    el.remove();
  }
}

/** Lightweight skeleton rows while lazy history is still in flight on chat switch. */
function buildChatHistoryPendingMarker(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'chat-history-pending';
  root.setAttribute('aria-busy', 'true');
  root.setAttribute('aria-label', 'Loading chat messages');
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'chat-history-pending__row';
    row.style.setProperty('--chat-history-pending-w', `${76 - i * 10}%`);
    root.appendChild(row);
  }
  return root;
}

/**
 * Clear the transcript mount and show a pending marker synchronously so a switch
 * never leaves another chat's bubbles visible during the history GET.
 */
export function paintChatTranscriptHistoryPending(mount?: string | HTMLElement): void {
  // An open board chat owns the pending marker too, or the previous task's
  // transcript lingers in `.ob-main` during the history GET.
  const boardChatHost = mount == null ? queryBoardChatTranscriptHost() : null;
  const area = boardChatHost ?? resolveChatMount(mount);
  const codeMount = boardChatHost != null || isCodeChatMount(mount);

  // Full-column overlays own #chatArea — same guard as renderChatFromHistory.
  if (codeMount && !boardChatHost && isMainColumnOverlaySuppressingChatDom()) {
    return;
  }

  const boardGroup = codeMount && !boardChatHost ? getActiveBoardGroup() : null;
  if (boardGroup?.viewMode === 'board') {
    return;
  }

  runWithChatMount(area, () => {
    clearSubAgentCardDomRegistry();
    clearTranscriptEmptyState(area);
    area.classList.remove('chat-area--hub');
    area.replaceChildren(buildChatHistoryPendingMarker());
  });
}

/** Route pending transcript paint to the active foreground shell (Code / Chat app / desktop). */
export function paintChatHistoryPendingInForegroundShell(): void {
  if (shouldPaintDesktopChatSurface()) {
    paintChatTranscriptHistoryPending('#desktopChatCol');
    return;
  }
  if (isChatAppForeground()) {
    paintChatTranscriptHistoryPending('#chatAppMessageCol');
    return;
  }
  if (
    dismissCodeOverviewForNavigation() ||
    dismissDevServerScreenForNavigation()
  ) {
    paintChatTranscriptHistoryPending();
    return;
  }
  paintChatTranscriptHistoryPending();
}

export function renderStatsForChat(chat: Chat): void {
  refreshMetricsStripForChat(chat);
  refreshContextUsageRing();
  if (isHubMounted()) refreshHubLiveData();
}

/** Empty transcript for a board task that has not run yet. */
function buildBoardChatEmptyState(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ob-chat__empty';
  wrap.setAttribute('role', 'status');

  const title = document.createElement('p');
  title.className = 'ob-chat__empty-title';
  title.textContent = 'This task has not started.';

  const hint = document.createElement('p');
  hint.className = 'ob-chat__empty-hint';
  hint.textContent = 'Its transcript appears here once the board runs it.';

  wrap.append(title, hint);
  return wrap;
}

export function renderChatFromHistory(chat: Chat, mount?: string | HTMLElement): void {
  /*
   * Board chats are not listed in the chats panel, so they never paint over the
   * column. When one is open from the Orchestrate screen it paints inside
   * `.ob-main`, beside the rail that lists it.
   */
  const boardChatHost =
    mount == null && isBoardChatEmbedOpenForChat(chat.id)
      ? queryBoardChatTranscriptHost()
      : null;
  const area = boardChatHost ?? resolveChatMount(mount);
  const codeMount = boardChatHost != null || isCodeChatMount(mount);
  const scrollAnchor = captureChatScrollAnchor();

  /*
   * The Super Plan surface suppresses transcript DOM like every other
   * full-column overlay, but unlike them it is bound to a chat. A paint for a
   * different chat is navigation away from it, so drop it first rather than
   * letting the guard below turn the navigation into a no-op.
   */
  if (codeMount && isSuperPlanScreenMountedForOtherChat(chat.id)) {
    teardownOrchestratePlanScreen();
  }

  /*
   * Code overview / code map / Issues embed own #chatArea — do not repaint
   * underneath. Orchestrate is on that list too (`chat-area--orchestrate`), but
   * a board chat paints *inside* it rather than over it, so the embed is exempt.
   */
  if (codeMount && !boardChatHost && isMainColumnOverlaySuppressingChatDom()) {
    return;
  }

  runWithChatMount(area, () => {
  suppressBubbleScroll = true;
  try {
  // Skipped for the embed: stripping overlay classes would take
  // `chat-area--orchestrate` off #chatArea and collapse the page around it.
  if (codeMount && !boardChatHost) {
    teardownCodeBrainMapBeforeChatPaint();
    teardownIssuesEmbedBeforeChatPaint();
    stripMainColumnOverlayClasses();
  }
  updateCodeChangeStrip(chat);
  if (codeMount && isOrchestrateHubMounted()) {
    teardownOrchestrateHub();
  }
  if (codeMount) {
    restoreOrchestratePlanScreenSessionFromChat(chat);
  }
  /*
   * Super Plan is a screen, not a conversation. Its chat carries the pipeline's
   * tool calls, which the surface already reports as stages, artifacts and a
   * ledger — so a super-plan chat always paints the planning surface and never
   * falls through to the transcript beneath it.
   */
  if (codeMount && normalizeModeId(chat.modeId) === 'super-plan') {
    if (isSuperPlanScreenShowingChat(chat.id)) return;
    teardownHub();
    removeOrchestratePlanScreenSuspendedBanner();
    reopenSuperPlanScreenForChat(chat);
    return;
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
  const boardGroup = codeMount && !boardChatHost ? getActiveBoardGroup() : null;
  if (boardGroup?.viewMode === 'board') {
    teardownHub();
    void import('./orchestrate-board-setup-banner').then((m) => m.removeBoardSetupReturnBanner());
    void import('./orchestrate-board').then((m) => {
      m.renderBoardView(boardGroup);
      m.refreshActiveBoardIfMounted();
    });
    return;
  }
  /*
   * A board chat with no board on screen would be a transcript with no home:
   * it has no row in the chats panel to navigate back from. Reopen the board
   * that owns it instead. Placed after the board branch above so the reopen
   * (which activates the planner, itself a board chat) settles rather than loops.
   */
  if (codeMount && !boardChatHost && isBoardOwnedChat(chat)) {
    const owner = getBoardGroupForChat(chat);
    if (owner) {
      void import('../state/chat-groups').then((m) => m.openBoardGroup(owner.id));
      return;
    }
  }
  void import('./orchestrate-board-setup-banner').then((m) => m.syncBoardSetupReturnBanner(chat));
  clearSubAgentCardDomRegistry();
  if (!chat.history.length) {
    if (boardChatHost) {
      // renderHub replaces all of #chatArea, which here is the Orchestrate page.
      // An unstarted task gets a line of its own instead.
      area.replaceChildren(buildBoardChatEmptyState());
    } else if (codeMount) {
      renderHub(chat);
      // Sub-agent cards mount in the transcript only (see sub-agent-cards.ts).
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

    if (msg.role === 'context') {
      appendContextNotice(area, msg as ContextNoticeMessage, i);
      continue;
    }

    if (msg.role === 'injection') {
      appendInjectionNotice(area, msg as InjectionNoticeMessage, i);
      continue;
    }

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

interface TranscriptNoticeChipOptions {
  action: string;
  outcome: string;
  icon: IconName;
  body?: string;
  historyIndex: number;
  emptyFallback: string;
}

function injectionNoticeIcon(kind: PromptInjectionKind): IconName {
  switch (kind) {
    case 'brain-notes':
      return 'appBrain';
    case 'code-map':
      return 'appCodeBrainMap';
    case 'context-documents':
      return 'contextDocuments';
    default:
      return 'fileText';
  }
}

function contextNoticeIcon(policy: ContextNoticeMessage['policy']): IconName {
  return policy === 'archive' ? 'archive' : 'compress';
}

function appendTranscriptNoticeChip(
  area: HTMLElement,
  options: TranscriptNoticeChipOptions,
  insertBefore?: ChildNode | null,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'context-notice tool-call-msg';
  wrap.dataset.historyIndex = String(options.historyIndex);

  const details = document.createElement('details');
  details.className = 'tool-call-details context-notice__details';

  const summary = document.createElement('summary');
  summary.className = 'tool-call-summary tool-call-summary--ok';

  const statusGlyph = document.createElement('span');
  statusGlyph.className = 'tool-call-status';
  statusGlyph.appendChild(
    createIcon(options.icon, { className: 'tool-call-icon', size: 15 }),
  );

  const action = document.createElement('span');
  action.className = 'tool-call-action';
  action.textContent = options.action;

  const outcome = document.createElement('span');
  outcome.className = 'tool-call-outcome';
  outcome.textContent = options.outcome;

  const chevron = createIcon('chevronDown', {
    className: 'tool-call-chevron',
    size: 14,
  });

  summary.appendChild(statusGlyph);
  summary.appendChild(action);
  summary.appendChild(outcome);
  summary.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'tool-call-body';

  if (options.body?.trim()) {
    const pre = document.createElement('pre');
    pre.className = 'context-notice__summary';
    pre.textContent = options.body;
    body.appendChild(pre);
  } else {
    const empty = document.createElement('p');
    empty.className = 'context-notice__empty';
    empty.textContent = options.emptyFallback;
    body.appendChild(empty);
  }

  details.appendChild(summary);
  details.appendChild(body);
  wrap.appendChild(details);
  if (insertBefore) {
    area.insertBefore(wrap, insertBefore);
  } else {
    area.appendChild(wrap);
  }
  return wrap;
}

function appendContextNotice(
  area: HTMLElement,
  notice: ContextNoticeMessage,
  historyIndex: number,
): void {
  appendTranscriptNoticeChip(area, {
    action: contextNoticeAction(notice.policy),
    outcome: contextNoticeOutcome(notice.droppedTurns, notice.summaryText),
    icon: contextNoticeIcon(notice.policy),
    body: notice.summaryText,
    historyIndex,
    emptyFallback: 'No summary text was recorded for this trim.',
  });
}

function appendInjectionNotice(
  area: HTMLElement,
  notice: InjectionNoticeMessage,
  historyIndex: number,
  insertBefore?: ChildNode | null,
): void {
  const wrap = appendTranscriptNoticeChip(
    area,
    {
      action: injectionNoticeAction(notice.kind),
      outcome: injectionNoticeOutcome(notice.body),
      icon: injectionNoticeIcon(notice.kind),
      body: notice.body,
      historyIndex,
      emptyFallback: 'No injection payload was recorded.',
    },
    insertBefore,
  );
  wrap.classList.add('context-notice--user-turn');
}

/**
 * Mount injection notice chips during an in-flight turn (before assistant stream).
 */
export function appendInjectionNoticesDom(
  notices: InjectionNoticeMessage[],
  startHistoryIndex: number,
  meta?: { chatId?: string },
): void {
  const active = getActiveChat();
  const targetId = meta?.chatId?.trim() || active.id;
  if (targetId !== active.id && !isStreamDomVisible(targetId)) return;
  const chat = resolveBubbleTargetChat({
    chatId: targetId,
    historyIndex: startHistoryIndex,
    turnKind: 'user',
  });
  if (shouldStubOrchestrateStreamDom(chat)) return;
  const mount = getActiveChatMountElement();
  clearTranscriptEmptyState(mount);
  // Live tool-loop path mounts the streaming assistant row before injection resolves;
  // keep injection chips on the user turn (above the in-flight assistant row).
  const insertBefore = mount.querySelector('.msg.assistant.msg--awaiting-prose');
  let index = startHistoryIndex;
  for (const notice of notices) {
    appendInjectionNotice(mount, notice, index, insertBefore);
    index += 1;
  }
  scrollChatIfPinned();
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
  const mount = getActiveChatMountElement();
  clearTranscriptEmptyState(mount);
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
  mount.appendChild(wrap);
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
  const mount = getActiveChatMountElement();
  clearTranscriptEmptyState(mount);
  if (isHubMounted()) {
    teardownHub();
  }

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
  beginStreamAnnouncer(wrap);
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
  cancelStreamAnnouncer();
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
  void (async () => {
    if (
      !(await appConfirm('Clear all messages in this chat? The chat stays in your sidebar.', {
        confirmLabel: 'Clear',
        danger: true,
      }))
    ) {
      return;
    }
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
  })();
}
