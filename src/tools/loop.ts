/**
 * Tool-aware chat send path (SA-7): streams completions, runs tool_calls loop,
 * and persists assistant / tool messages in session history.
 */

import {
  chatFetchAbort,
  modelCache,
  setChatFetchAbort,
  setStreaming,
} from '../app-state';
import {
  beginChatTurnSetup,
  endChatTurnSetup,
  isChatTurnSetupPending,
} from '../chat/chat-turn-guard';
import {
  isActiveChatStreaming,
  isBackgroundStreamBlockingSend,
  isStreamDomVisible,
} from '../chat/streaming-state';
import {
  clearAttachments,
  getPendingAttachments,
  replacePendingAttachments,
} from '../attachments/store';
import type { Attachment } from '../attachments/types';
import { resolveWorkspaceReferences } from '../attachments/workspace-ref';
import {
  extractMessageText,
  extractStreamDelta,
  finalizeResponseMeta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  parseSsePayloads,
  tryNonStreamingFallback,
  type StreamMetaAccumulator,
} from '../api/chat';
import { extractReasoningDelta, extractReasoningMessage } from '../api/reasoning';
import { resolveModelInfo } from '../api/models';
import {
  cancelAssistantBubbleRenderDebounce,
  scheduleAssistantBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import {
  isFirstUserMessagePending,
  scheduleChatTitleGeneration,
} from '../chat/titles/schedule';
import {
  clearMainTurnActivity,
  emitMainTurnActivity,
  patchMainTurnActivity,
} from '../chat/main-turn-activity';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
  recordChatMessage,
} from '../state/sessions';
import type {
  ApiMessage,
  ApiMessageContent,
  AssistantMessage,
  AssistantToolCallMessage,
  Chat,
  ChatCompletionChunk,
  ContentPart,
  Message,
  ToolCall,
  ToolCallAccumulator,
} from '../types';
import { markMessageStopped } from '../ui/stopped-affordance';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import {
  setComposerStreamingMode,
  syncComposerFromStreamingState,
} from '../ui/composer-send';
import { registerStreamDomRemount } from './stream-chat-dom';
import { refreshExpertSelectDisabled } from '../ui/expert-select';
import { refreshModeSelectorDisabled } from '../ui/mode-selector';
import { refreshOrchestratePlanSelectorDisabled } from '../ui/orchestrate-plan-selector';
import {
  refreshActiveBoardIfMounted,
  refreshBoardOnboardingIfMounted,
  renderBoardView,
} from '../ui/orchestrate-board';
import {
  isBoardViewActive,
  isOrchestrateBoardViewActive,
  refreshViewModeToggleDisabled,
  syncViewModeToggleFromActiveChat,
} from '../ui/view-mode-toggle';
import { setBugBoardExecutorContext } from './bug-board-tools';
import {
  appendBubble,
  appendStats,
  appendStreamingAssistantRow,
  assistantProseHasVisibleContent,
  removeOrphanStreamingRow,
  revealAssistantProseBubble,
  setAssistantErrorBubble,
} from '../ui/messages';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { ThinkingDurationTracker } from '../ui/thinking-duration';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import {
  recordAssistantReplyOnChat,
  setSidebarStreamPhase,
  syncChatItemDotsInDom,
} from '../ui/chat-item-dot';
import { renderSidebar } from '../ui/sidebar';
import {
  cancelGeneration,
  createGeneration,
  GenerationNotFoundError,
  GENERATION_LOST_ON_RESTART_MESSAGE,
  subscribeToGeneration,
} from '../api/generations';
import { getActiveProvider } from '../providers/store';
import { setStatus } from '../ui/status';
import { applyOrchestrateAggregatedStatsToChat } from '../chat/orchestrate/stats-aggregate';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { resolveOutboundSystemMessages } from '../chat/prompts/compose-context';
import { estimateTokensFromText } from '../chat/prompts/token-estimate';
import { pushOutboundSystemMessages } from './api-system-messages';
import { normalizeModeId } from '../chat/modes/types';
import {
  orchestrateRequiresPlanBlock,
  resolveOrchestrateSlashInput,
} from '../chat/orchestrate/send-gate';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import { resolveWorkAgentBinding } from '../agents/resolve-work-agent-binding';
import { UI_DESIGNER_AGENT_ID } from '../agents/ui-designer/constants';
import { resolveUiDesignerBinding } from '../agents/ui-designer/config';
import {
  applyUiDesignerToolFilter,
  augmentSkillBodyForUiDesigner,
  prepareUiDesignerTurn,
} from '../agents/ui-designer/runner';
import { assertUiDesignerToolAllowed } from '../agents/ui-designer/tools';
import { WorkAgentConfigError } from '../agents/work-agent-types';
import { getUserWorkAgentOverride } from '../agents/work-agent-registry';
import {
  cancelAllForParentTurn,
} from '../agents/orchestrator';
import { createSubAgentRunId } from '../agents/sub-agent-run-id';
import {
  detectLocalServer,
  executeTool,
  getEnabledToolDefinitionsForMode,
} from './client';
import { setBoardExecutorContext } from './board-tools';
import { setSubAgentExecutorContext } from './sub-agent-executor';
import { indexOfLastUserMessage } from '../chat/history-truncate-core';
import {
  augmentImpeccableSkillBody,
  formatHistoryWithSkillTag,
  IMPECCABLE_SKILL_ID,
  parseSlashCommand,
  resolveActiveSkill,
} from '../skills';
import {
  EMPTY_POST_TOOL_CONTINUE_INSTRUCTION,
  hasPostToolTail,
  logTurnDebug,
  resolveFinalAssistantContent,
  resolveTurnContinuation,
} from './turn-continuation';
import {
  DEFAULT_CHAT_MAX_TOOL_TURNS,
  getChatMetaSync,
} from '../config/chat-meta';

/** Default max assistant↔tool rounds (see Settings → General and `chat.maxToolTurns` in config). */
export const MAX_TOOL_TURNS = DEFAULT_CHAT_MAX_TOOL_TURNS;

/** Options for {@link buildApiMessages} when the composer has pending files. */
export interface BuildApiMessagesOptions {
  /** Active model id (used to detect VLM for multimodal user content). */
  modelId?: string;
  /** Raw user text from the composer for the in-flight turn (not history placeholders). */
  pendingUserText?: string;
  /** Pre-composed system prompt (Step 04); overrides legacy sysPrompt when set. */
  composedSystemPrompt?: string;
  /** Second system message: global user rules (Feature 24). */
  userRulesContent?: string;
  /** Ephemeral user line after an empty post-tool model reply (not stored in history). */
  ephemeralContinueInstruction?: string;
}

interface ChatCompletionBody {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: ReturnType<typeof getEnabledToolDefinitionsForMode>;
  tool_choice?: 'auto';
}

/** History placeholder for an image attachment (persisted in UserMessage.content). */
function imageHistoryPlaceholder(name: string): string {
  return `[image: ${name}]`;
}

/** Inline file block for text/PDF content in string user messages. */
function fileContentBlock(name: string, body: string): string {
  const safeName = name.replace(/"/g, "'");
  return `<file name="${safeName}">\n${body}\n</file>`;
}

/** User-visible / persisted content: text, file blocks, and image placeholders. */
export function buildHistoryUserContent(
  userText: string,
  attachments: Attachment[],
): string {
  const parts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) parts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error') continue;
    if (att.kind === 'image') {
      parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      parts.push(fileContentBlock(att.name, att.text));
    }
  }

  return parts.join('\n\n');
}

/** Non-VLM API payload: one string with text, file blocks, and image placeholders. */
function buildStringUserApiContent(
  userText: string,
  attachments: Attachment[],
): string {
  return buildHistoryUserContent(userText, attachments);
}

/** VLM API payload: text part plus image_url parts (no image placeholders in text). */
function buildVlmUserApiContent(
  userText: string,
  attachments: Attachment[],
): ContentPart[] {
  const textParts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) textParts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error' || att.kind === 'image') continue;
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      textParts.push(fileContentBlock(att.name, att.text));
    }
  }

  const parts: ContentPart[] = [];
  const combinedText = textParts.join('\n\n');
  if (combinedText) {
    parts.push({ type: 'text', text: combinedText });
  }

  for (const att of attachments) {
    if (att.kind === 'image' && att.dataUrl) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.dataUrl, detail: 'auto' },
      });
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: trimmed || '' });
  }

  return parts;
}

function isVlmModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  return modelCache.get(modelId)?.type === 'vlm';
}

/** Options for {@link runChatTurn} (composer send or history resend). */
export interface RunChatTurnOptions {
  chat: Chat;
  /** When false, the last user row in history is reused (regenerate / remake). */
  pushUser: boolean;
  rawText: string;
  userText: string;
  skillId: string | null;
  displayText: string;
  historyContent: string;
  validAttachments: Attachment[];
  titleSeed?: string;
  shouldScheduleTitle?: boolean;
  /** Pre-resolved skill body when skillId is set (composer path). */
  skillBody?: string | null;
  /** Re-subscribe to an existing backend generation (boot resume); skips POST. */
  resumeGenerationId?: string;
  /** When false, do not set the global streaming flag (background re-subscribe). */
  ownsGlobalStreaming?: boolean;
}

/**
 * Serialize session history for LM Studio, including tool_calls and tool results.
 * Pending attachments on the last user turn become multimodal API content (VLM) or
 * inlined file blocks; history stays string-only with `[image: …]` placeholders.
 */
export function buildApiMessages(
  chat: Chat,
  sysPrompt: string,
  options?: BuildApiMessagesOptions,
): ApiMessage[] {
  const messages: ApiMessage[] = [];
  pushOutboundSystemMessages(messages, {
    composedSystemPrompt: options?.composedSystemPrompt,
    legacySysPrompt: sysPrompt,
    userRulesContent: options?.userRulesContent,
  });

  const pending = getPendingAttachments().filter((a) => a.kind !== 'error');
  const lastUserIdx = indexOfLastUserMessage(chat.history);
  const modelId = options?.modelId;
  const vlm = isVlmModel(modelId);

  for (let i = 0; i < chat.history.length; i += 1) {
    const m = chat.history[i];
    if (m.role === 'user') {
      const isLastUser = i === lastUserIdx;
      if (isLastUser && pending.length > 0) {
        const userText = options?.pendingUserText ?? m.content;
        const content: ApiMessageContent = vlm
          ? buildVlmUserApiContent(userText, pending)
          : buildStringUserApiContent(userText, pending);
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: m.content });
      }
      continue;
    }

    if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
      continue;
    }

    if (m.role === 'assistant') {
      const withTools = m as AssistantToolCallMessage;
      if (withTools.tool_calls?.length) {
        messages.push({
          role: 'assistant',
          content: withTools.content ?? null,
          tool_calls: withTools.tool_calls,
        });
      } else {
        messages.push({ role: 'assistant', content: m.content });
      }
    }
  }

  const continueLine = options?.ephemeralContinueInstruction?.trim();
  if (continueLine) {
    messages.push({ role: 'user', content: continueLine });
  }

  return messages;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

interface StreamTurnResult {
  fullText: string;
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  tEnd: number;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
}

/**
 * Stream one completion via backend-owned generation (POST + subscribe, or subscribe-only).
 */
async function streamCompletionTurn(
  chat: Chat,
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
  body: ChatCompletionBody,
  resumeGenerationId: string | undefined,
  bubble: HTMLDivElement,
  cursor: HTMLDivElement,
  signal: AbortSignal,
  thoughtController: ThoughtBubbleController | null,
  domVisible: boolean,
  onFirstProseDelta?: () => void,
  onPartialText?: (fullText: string) => void,
  onStreamConnected?: () => void,
): Promise<StreamTurnResult> {
  let generationId = resumeGenerationId;

  if (!generationId) {
    const created = await createGeneration(provider.id, body, { persist: true });
    generationId = created.generationId;
    chat.currentGenerationId = generationId;
    scheduleSaveSessions();
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;
  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoning = extractReasoningDelta(chunk);
    if (reasoning) {
      thoughtController?.appendReasoningDelta(reasoning);
    }
    const delta = extractStreamDelta(chunk);
    if (delta) {
      thoughtController?.endReasoningPhase();
      onFirstProseDelta?.();
      if (tFirst == null) tFirst = performance.now();
      fullText += delta;
      onPartialText?.(fullText);
      if (domVisible) {
        scheduleAssistantBubbleRender(bubble, fullText, cursor);
      }
    }
    if (domVisible) {
      scrollChatIfPinned();
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      const unsubscribe = subscribeToGeneration(generationId!, {
        signal,
        onStreamOpen: onStreamConnected,
        onChunk: handleChunk,
        onEnd: () => {
          finish(resolve);
        },
        onTransportError: (err) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        },
      });

      signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          finish(() => reject(new DOMException('Aborted', 'AbortError')));
        },
        { once: true },
      );
    });

    chat.currentGenerationId = undefined;
    scheduleSaveSessions();
  } catch (err) {
    if (err instanceof GenerationNotFoundError) {
      chat.currentGenerationId = undefined;
      scheduleSaveSessions();
      throw new Error(GENERATION_LOST_ON_RESTART_MESSAGE);
    }
    const e = err as { name?: string };
    if (e?.name === 'AbortError') {
      await cancelGeneration(generationId!);
      throw err;
    }
    throw err;
  }

  onPartialText?.(fullText);

  thoughtController?.endReasoningPhase();

  const tEnd = performance.now();
  const finishReason = streamMeta.finish_reason;
  const toolCalls = finalizeToolCalls(toolAcc);

  return {
    fullText,
    streamMeta,
    t0,
    tFirst,
    tEnd,
    finishReason,
    toolCalls,
  };
}

/**
 * Run the tool-aware SSE loop for one user turn (optionally skip pushing a new user row).
 */
export async function runChatTurn(options: RunChatTurnOptions): Promise<void> {
  const {
    chat,
    pushUser,
    rawText,
    userText,
    skillId,
    historyContent,
    validAttachments,
    titleSeed = userText || rawText,
    shouldScheduleTitle = false,
    skillBody: presetSkillBody = null,
    resumeGenerationId,
    ownsGlobalStreaming = true,
  } = options;

  if (!beginChatTurnSetup(chat.id)) {
    return;
  }

  try {
  const modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  const temp = parseFloat((document.getElementById('temperature') as HTMLInputElement).value);
  const maxTok = parseInt((document.getElementById('maxTokens') as HTMLInputElement).value, 10);
  const legacySysPrompt = (
    document.getElementById('systemPrompt') as HTMLTextAreaElement
  ).value.trim();

  if (chatFetchAbort) chatFetchAbort.abort();
  const controller = new AbortController();
  setChatFetchAbort(controller);
  const chatSignal = controller.signal;
  const parentTurnId = createSubAgentRunId();
  const loopModeId = normalizeModeId(chat.modeId);
  setSubAgentExecutorContext({
    parentTurnId,
    modeId: loopModeId,
    parentChatId: chat.id,
  });
  setBoardExecutorContext({ chatId: chat.id });
  setBugBoardExecutorContext({ chatId: chat.id });

  if (normalizeModeId(chat.modeId) === 'orchestrate' && chat.orchestrateBoard) {
    chat.orchestrateBoard.activeParentTurnId = parentTurnId;
    touchChat(chat);
    scheduleSaveSessions();
  }

  chat.modelId = modelId || chat.modelId;

  if (pushUser) {
    chat.history.push({ role: 'user', content: historyContent });
    recordChatMessage(chat);
    scheduleSaveSessions();
    renderSidebar();
    const userIdx = chat.history.length - 1;
    const { wrap: userWrap } = appendBubble(
      'user',
      historyContent,
      {
        historyIndex: userIdx,
        turnKind: 'user',
        chatId: chat.id,
      },
      { liveAttachments: validAttachments },
    );
    const { attachMessageActions } = await import('../ui/message-actions');
    attachMessageActions(userWrap, {
      chatId: chat.id,
      historyIndex: userIdx,
      turnKind: 'user',
    });
    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    input.value = '';
    input.style.height = 'auto';
  }

  const activeWorkAgent = resolveActiveWorkAgent(chat);
  let sendModelId = modelId || chat.modelId;
  let sendProviderId = chat.providerId;

  const uiDesignerCtx = prepareUiDesignerTurn(chat, {
    skillId,
    userText,
    workAgentId: chat.workAgentId,
  });
  const savedWorkAgentId = chat.workAgentId;
  if (uiDesignerCtx.active) {
    chat.workAgentId = UI_DESIGNER_AGENT_ID;
  }

  try {
    const sendProvider = await getActiveProvider(chat.providerId);
    if (uiDesignerCtx.active) {
      const binding = await resolveUiDesignerBinding(chat, {
        providerId: sendProvider.id,
        modelId: sendModelId,
      });
      sendModelId = binding.modelId;
      sendProviderId = binding.providerId;
    } else {
      const binding = await resolveWorkAgentBinding(
        activeWorkAgent,
        chat,
        { providerId: sendProvider.id, modelId: sendModelId },
        {
          userOverride: activeWorkAgent
            ? getUserWorkAgentOverride(activeWorkAgent.id)
            : undefined,
        },
      );
      sendModelId = binding.modelId;
      sendProviderId = binding.providerId;
    }
  } catch (err) {
    if (err instanceof WorkAgentConfigError) {
      setStatus('err', err.message);
      if (uiDesignerCtx.active) {
        chat.workAgentId = savedWorkAgentId;
      }
      return;
    }
    throw err;
  }

  chat.modelId = sendModelId;
  chat.providerId = sendProviderId;
  if (shouldScheduleTitle) {
    scheduleChatTitleGeneration(chat.id, titleSeed, {
      modelId: sendModelId,
      providerId: sendProviderId,
    });
  }

  const mainTurnLabel = uiDesignerCtx.active
    ? 'UI Designer'
    : activeWorkAgent?.label?.trim() || 'Main turn';
  const turnStartedAtMs = Date.now();
  emitMainTurnActivity({
    chatId: chat.id,
    phase: 'generating',
    currentTool: null,
    workAgentLabel: mainTurnLabel,
    modelId: sendModelId,
    providerId: sendProviderId,
    startedAtMs: turnStartedAtMs,
  });

  const agentStatusSuffix = uiDesignerCtx.active
    ? ' (UI Designer)'
    : activeWorkAgent?.label
      ? ` (${activeWorkAgent.label})`
      : '';

  if (ownsGlobalStreaming) {
    setStreaming(true, chat.id);
    refreshModeSelectorDisabled();
    refreshExpertSelectDisabled();
    refreshOrchestratePlanSelectorDisabled();
    refreshBoardOnboardingIfMounted();
    refreshViewModeToggleDisabled();
    if (isStreamDomVisible(chat.id)) {
      setComposerStreamingMode('streaming');
    } else {
      syncComposerFromStreamingState();
    }
  }
  let livePartialText = '';
  if (isStreamDomVisible(chat.id)) {
    setStatus(
      'spin',
      uiDesignerCtx.active
        ? `${uiDesignerCtx.statusHint}…`
        : `Generating reply${agentStatusSuffix}…`,
    );
  }

  let streamRow = appendStreamingAssistantRow(chat.id);
  let { wrap, bubble, cursor, streamStatus } = streamRow;
  const streamCtx = { wrap, streamStatus };
  let revealProse = (): void => {
    if (!isStreamDomVisible(chat.id)) return;
    revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
  };

  let completedNormally = false;
  let lastWrap = wrap;
  let thoughtController: ThoughtBubbleController | null = null;
  let thinkingTracker: ThinkingDurationTracker | null = null;

  registerStreamDomRemount(chat.id, (row) => {
    streamRow = row;
    wrap = row.wrap;
    bubble = row.bubble;
    cursor = row.cursor;
    streamStatus = row.streamStatus;
    streamCtx.wrap = wrap;
    streamCtx.streamStatus = streamStatus;
    lastWrap = wrap;
    revealProse = (): void => {
      if (!isStreamDomVisible(chat.id)) return;
      revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
    };
    thoughtController?.setAssistantWrap(wrap);
  });

  thinkingTracker = new ThinkingDurationTracker((elapsedMs) => {
    if (isStreamDomVisible(chat.id)) {
      streamCtx.streamStatus.setThinkingElapsed(elapsedMs);
    }
  });

  const thoughtPhaseCallbacks = {
    onThinkingStart: (): void => {
      patchMainTurnActivity(chat.id, { phase: 'thinking', currentTool: null });
      if (isStreamDomVisible(chat.id)) {
        streamCtx.streamStatus.setPhase('thinking');
      }
      setSidebarStreamPhase('thinking');
      thinkingTracker?.startSegment();
    },
    onReasoningEnded: (): void => {
      thinkingTracker?.endSegment();
      if (isStreamDomVisible(chat.id)) {
        streamCtx.streamStatus.setThinkingElapsed(null);
        if (streamCtx.wrap.classList.contains('msg--awaiting-prose')) {
          streamCtx.streamStatus.setPhase('generating');
          setSidebarStreamPhase('generating');
        } else {
          setSidebarStreamPhase(null);
        }
      } else {
        setSidebarStreamPhase(null);
      }
    },
  };

  let skillBody: string | null = presetSkillBody;
  if (!skillBody && skillId) {
    const skill = await resolveActiveSkill(skillId);
    if (skill?.body?.trim()) {
      skillBody = skill.body;
    }
  }
  if (skillBody && skillId === IMPECCABLE_SKILL_ID && !presetSkillBody) {
    skillBody = await augmentImpeccableSkillBody(skillBody, userText);
  }
  if (skillBody && uiDesignerCtx.active) {
    skillBody = augmentSkillBodyForUiDesigner(skillBody, uiDesignerCtx);
  }

  const outbound = await resolveOutboundSystemMessages(chat, legacySysPrompt, {
    userMessagePreview: userText || rawText,
    routeUserText: userText || rawText,
    overrides: { skillBody },
  });
  const sysPrompt = outbound.composed;
  const userRulesContent = outbound.userRules;

  try {
    const provider = await getActiveProvider(sendProviderId);
    thoughtController = new ThoughtBubbleController(wrap, thoughtPhaseCallbacks);

    const activeModeId = normalizeModeId(chat.modeId);
    let emptyPostToolRetries = 0;
    let ephemeralPostToolInstruction: string | undefined;
    const maxToolTurns = getChatMetaSync().maxToolTurns;

    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (chatSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let enabledTools = getEnabledToolDefinitionsForMode(activeModeId);
      if (activeWorkAgent?.allowedTools?.length) {
        const allow = new Set(activeWorkAgent.allowedTools);
        enabledTools = enabledTools.filter((t) => allow.has(t.function.name));
      }
      enabledTools = applyUiDesignerToolFilter(enabledTools, uiDesignerCtx);
      const messages = buildApiMessages(chat, sysPrompt, {
        modelId: sendModelId,
        pendingUserText: pushUser ? userText || rawText : undefined,
        composedSystemPrompt: sysPrompt,
        userRulesContent: userRulesContent ?? undefined,
        ephemeralContinueInstruction: ephemeralPostToolInstruction,
      });
      const body: ChatCompletionBody = {
        model: sendModelId || undefined,
        messages,
        temperature: temp,
        max_tokens: maxTok,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (enabledTools.length > 0) {
        body.tools = enabledTools;
        body.tool_choice = 'auto';
      }

      thoughtController.setAssistantWrap(wrap);
      const domVisible = isStreamDomVisible(chat.id);
      const turnResult = await streamCompletionTurn(
        chat,
        provider,
        body,
        resumeGenerationId,
        bubble,
        cursor,
        chatSignal,
        thoughtController,
        domVisible,
        revealProse,
        (text) => {
          livePartialText = text;
        },
      );

      cancelAssistantBubbleRenderDebounce();
      cursor.remove();

      const finishReason =
        turnResult.finishReason ||
        (turnResult.toolCalls.length > 0 ? 'tool_calls' : undefined);

      const lastHistoryRole = chat.history[chat.history.length - 1]?.role;
      logTurnDebug({
        turn,
        finishReason: finishReason ?? null,
        toolCalls: turnResult.toolCalls.length,
        fullTextLen: turnResult.fullText.length,
        lastHistoryRole: lastHistoryRole ?? null,
        emptyPostToolRetries,
      });

      if (finishReason === 'tool_calls' && turnResult.toolCalls.length === 0) {
        logTurnDebug({ event: 'empty_tool_calls_after_finalize', turn });
      }

      if (finishReason === 'tool_calls' && turnResult.toolCalls.length > 0) {
        const toolProse = turnResult.fullText.trim();
        if (toolProse && isStreamDomVisible(chat.id)) {
          revealProse();
          setAssistantBubbleContent(bubble, toolProse, { streaming: false, modeId: chat.modeId });
        } else if (!toolProse && isStreamDomVisible(chat.id)) {
          removeOrphanStreamingRow(wrap, streamStatus);
        }

        const assistantToolMsg: AssistantToolCallMessage = {
          role: 'assistant',
          content: toolProse || null,
          tool_calls: turnResult.toolCalls,
        };
        chat.history.push(assistantToolMsg);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();
        if (isStreamDomVisible(chat.id)) {
          setStatus('spin', 'Running tools…');
        }
        patchMainTurnActivity(chat.id, { phase: 'tools' });

        const area = document.getElementById('chatArea')!;
        const paintToolCallsInChat =
          !isBoardViewActive() && isStreamDomVisible(chat.id);
        const STOPPED_TOOL_MSG = 'Stopped by user.';
        for (let ti = 0; ti < turnResult.toolCalls.length; ti++) {
          if (chatSignal.aborted) {
            for (let sj = ti; sj < turnResult.toolCalls.length; sj++) {
              const skipped = turnResult.toolCalls[sj]!;
              const skipArgs = parseToolArguments(skipped.function.arguments);
              const skipWrap = renderToolCall(skipped.function.name, skipArgs);
              skipWrap.dataset.toolCallId = skipped.id;
              if (paintToolCallsInChat) {
                area.appendChild(skipWrap);
              }
              renderToolResult(skipWrap, STOPPED_TOOL_MSG);
              chat.history.push({
                role: 'tool',
                tool_call_id: skipped.id,
                content: STOPPED_TOOL_MSG,
              });
            }
            recordChatMessage(chat);
            scheduleSaveSessions();
            throw new DOMException('Aborted', 'AbortError');
          }

          const tc = turnResult.toolCalls[ti]!;
          const args = parseToolArguments(tc.function.arguments);
          patchMainTurnActivity(chat.id, {
            phase: 'tools',
            currentTool: tc.function.name,
          });
          const toolWrap = renderToolCall(tc.function.name, args);
          toolWrap.dataset.toolCallId = tc.id;
          if (paintToolCallsInChat) {
            area.appendChild(toolWrap);
            scrollChatIfPinned();
          }

          const toolLoopModeId = normalizeModeId(chat.modeId);
          setSubAgentExecutorContext({
            parentTurnId,
            modeId: toolLoopModeId,
            parentChatId: chat.id,
            parentToolCallId: tc.id,
          });
          setBoardExecutorContext({ chatId: chat.id });
          setBugBoardExecutorContext({ chatId: chat.id });

          const planBlock = uiDesignerCtx.active
            ? assertUiDesignerToolAllowed(tc.function.name, uiDesignerCtx.mode)
            : null;
          const toolOut = planBlock
            ? { content: planBlock }
            : await executeTool(tc.function.name, args, {
                chatId: chat.id,
                toolCallId: tc.id,
                modeId: toolLoopModeId,
              });
          renderToolResult(toolWrap, toolOut.content, toolOut.attachments, args);

          chat.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolOut.content,
            ...(toolOut.attachments?.length
              ? { attachments: toolOut.attachments }
              : {}),
          });
          if (paintToolCallsInChat) {
            scrollChatIfPinned();
          }
        }

        recordChatMessage(chat);
        scheduleSaveSessions();
        renderSidebar();

        if (isOrchestrateBoardViewActive() && getActiveChat().id === chat.id) {
          refreshActiveBoardIfMounted();
        }

        if (turn + 1 >= maxToolTurns) {
          setStatus('err', 'Maximum tool turns reached');
          break;
        }

        streamRow = appendStreamingAssistantRow(chat.id);
        ({ wrap, bubble, cursor, streamStatus } = streamRow);
        streamCtx.wrap = wrap;
        streamCtx.streamStatus = streamStatus;
        lastWrap = wrap;
        revealProse = (): void => {
          if (!isStreamDomVisible(chat.id)) return;
          revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
        };
        thoughtController.setAssistantWrap(wrap);
        thoughtController.resetStreamPhaseHints();

        if (isStreamDomVisible(chat.id)) {
          setStatus('spin', 'Generating reply…');
        }
        patchMainTurnActivity(chat.id, { phase: 'generating', currentTool: null });
        ephemeralPostToolInstruction = undefined;
        continue;
      }

      let fullText = turnResult.fullText;
      let streamMeta = turnResult.streamMeta;

      if (!fullText.trim()) {
        const fallbackBody: ChatCompletionBody = {
          model: sendModelId || undefined,
          messages,
          temperature: temp,
          max_tokens: maxTok,
        };
        if (enabledTools.length > 0) {
          fallbackBody.tools = enabledTools;
          fallbackBody.tool_choice = 'auto';
        }
        const fallback = await tryNonStreamingFallback(
          fallbackBody,
          chatSignal,
          sendProviderId,
        );
        const fbMsg = fallback.choices?.[0]?.message;
        fullText = extractMessageText(fbMsg);
        const fbReason = extractReasoningMessage(fbMsg);
        if (fbReason) {
          thoughtController?.ingestCompletedReasoning(fbReason);
        }
        streamMeta = mergeStreamMeta(streamMeta, fallback);
      }

      const continuation = resolveTurnContinuation({
        finishReason,
        toolCallsCount: turnResult.toolCalls.length,
        fullTextLength: fullText.trim().length,
        hasPostToolTail: hasPostToolTail(chat.history),
        emptyPostToolRetries,
      });

      if (continuation === 'retryEmpty') {
        emptyPostToolRetries += 1;
        ephemeralPostToolInstruction = EMPTY_POST_TOOL_CONTINUE_INSTRUCTION;
        logTurnDebug({
          event: 'retry_empty_post_tool',
          turn,
          emptyPostToolRetries,
        });
        removeOrphanStreamingRow(wrap, streamStatus);
        streamRow = appendStreamingAssistantRow(chat.id);
        ({ wrap, bubble, cursor, streamStatus } = streamRow);
        streamCtx.wrap = wrap;
        streamCtx.streamStatus = streamStatus;
        lastWrap = wrap;
        revealProse = (): void => {
          if (!isStreamDomVisible(chat.id)) return;
          revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
        };
        thoughtController.setAssistantWrap(wrap);
        thoughtController.resetStreamPhaseHints();
        if (isStreamDomVisible(chat.id)) {
          setStatus('spin', 'Generating reply…');
        }
        patchMainTurnActivity(chat.id, { phase: 'generating', currentTool: null });
        continue;
      }

      const thinkingNorm = thoughtController?.getSegmentsNormalized() ?? [];
      const hasMeaningfulProse = assistantProseHasVisibleContent(
        fullText,
        thinkingNorm.length > 0,
      );
      const { content: finalContent, usedThinkingAsContent } =
        resolveFinalAssistantContent(fullText, thinkingNorm);

      if (!fullText.trim()) {
        logTurnDebug({
          event: 'finalize_empty_completion',
          turn,
          finalContentLen: finalContent.length,
          usedThinkingAsContent,
          persisted: hasMeaningfulProse,
        });
      }

      const meta = finalizeResponseMeta(
        streamMeta,
        turnResult.t0,
        turnResult.tFirst ?? turnResult.tEnd,
        turnResult.tEnd,
      );
      const displayMeta = applyOrchestrateAggregatedStatsToChat(chat, parentTurnId, meta);
      const modelInfo = resolveModelInfo(streamMeta.model || modelId, displayMeta.model_info);
      const thinkingDurationMs = thinkingTracker?.finalize() ?? 0;
      chat.lastStats = buildLastStatsSnapshot(displayMeta.stats, displayMeta.usage);
      chat.modelInfo = { ...modelInfo };
      chat.modelId =
        (document.getElementById('modelSelect') as HTMLSelectElement).value || chat.modelId;

      if (hasMeaningfulProse) {
        if (isStreamDomVisible(chat.id)) {
          revealProse();
          setAssistantBubbleContent(bubble, finalContent, {
            streaming: false,
            modeId: chat.modeId,
          });
        }
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: finalContent,
          stats: meta.stats,
          usage: meta.usage,
        };
        if (thinkingNorm.length > 0) {
          assistantMsg.thinking = thinkingNorm;
          if (thinkingDurationMs > 0) {
            assistantMsg.thinkingDurationMs = thinkingDurationMs;
          }
        }
        chat.history.push(assistantMsg);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        if (isStreamDomVisible(chat.id)) {
          appendStats(lastWrap, meta.stats, meta.usage);
          if (thinkingNorm.length > 0) {
            renderThoughtsToggle(lastWrap, thinkingNorm, {
              durationMs: thinkingDurationMs > 0 ? thinkingDurationMs : undefined,
            });
          }
          updateStrip(displayMeta.stats, displayMeta.usage, modelInfo);
          setStatus('ok', 'Ready');
        }
      } else if (isStreamDomVisible(chat.id)) {
        removeOrphanStreamingRow(streamCtx.wrap, streamCtx.streamStatus);
        updateStrip(displayMeta.stats, displayMeta.usage, modelInfo);
        setStatus('ok', 'Ready');
      }
      renderSidebar();
      scheduleSaveSessions();

      completedNormally = true;
      break;
    }

    if (!completedNormally) {
      const attachHint =
        getPendingAttachments().length > 0 ? ' Attachments kept for retry.' : '';
      setStatus('err', `Maximum tool turns reached.${attachHint}`);
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e && e.name === 'AbortError') {
      cancelAllForParentTurn(parentTurnId);
      thinkingTracker?.abort();
      streamCtx.streamStatus.setThinkingElapsed(null);
      chat.currentGenerationId = undefined;
      scheduleSaveSessions();

      cancelAssistantBubbleRenderDebounce();
      if (cursor.parentElement) cursor.remove();
      thoughtController?.abort();

      const text = livePartialText.trim();
      const thinkingNorm = thoughtController?.getSegmentsNormalized() ?? [];
      const wrapConnected = streamCtx.wrap.isConnected;

      if (text && wrapConnected) {
        streamCtx.wrap.classList.remove('msg--awaiting-prose');
        bubble.classList.remove('msg-bubble--awaiting');
        setAssistantBubbleContent(bubble, text, { streaming: false, modeId: chat.modeId });
        markMessageStopped(streamCtx.wrap);
      } else if (wrapConnected && streamCtx.wrap.classList.contains('msg--awaiting-prose')) {
        removeOrphanStreamingRow(streamCtx.wrap, streamCtx.streamStatus);
      }

      if (text || thinkingNorm.length > 0) {
        const { content: finalContent } = resolveFinalAssistantContent(
          text,
          thinkingNorm,
        );
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: finalContent,
          stopped: true,
        };
        if (thinkingNorm.length > 0) {
          assistantMsg.thinking = thinkingNorm;
        }
        chat.history.push(assistantMsg);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();
      }

      streamCtx.streamStatus.dispose();
      setStatus('ok', 'Stopped');
      return;
    }
    if (resumeGenerationId) {
      chat.currentGenerationId = undefined;
      scheduleSaveSessions();
    }
    cancelAssistantBubbleRenderDebounce();
    if (isStreamDomVisible(chat.id)) {
      if (cursor.parentElement) cursor.remove();
      revealProse();
      const lost =
        e.message === GENERATION_LOST_ON_RESTART_MESSAGE
          ? GENERATION_LOST_ON_RESTART_MESSAGE
          : `Could not complete this reply: ${e.message ?? 'Unknown error'}`;
      setAssistantErrorBubble(bubble, lost);
      const msg = e.message ?? '';
      const statusMsg = msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
      const attachHint =
        getPendingAttachments().length > 0 ? ' Attachments kept for retry.' : '';
      setStatus('err', statusMsg + attachHint);
    }
  } finally {
    registerStreamDomRemount(chat.id, null);
    if (uiDesignerCtx.active) {
      chat.workAgentId = savedWorkAgentId;
    }
    setSubAgentExecutorContext(null);
    setBoardExecutorContext(null);
    setBugBoardExecutorContext(null);
    if (
      normalizeModeId(chat.modeId) === 'orchestrate' &&
      chat.orchestrateBoard?.activeParentTurnId
    ) {
      chat.orchestrateBoard.activeParentTurnId = null;
      touchChat(chat);
      scheduleSaveSessions();
    }
    thoughtController?.abort();
    thinkingTracker?.abort();
    if (completedNormally) {
      clearAttachments();
    }
    clearMainTurnActivity(chat.id);
    if (ownsGlobalStreaming) {
      setStreaming(false);
      setSidebarStreamPhase(null);
      syncChatItemDotsInDom();
      refreshModeSelectorDisabled();
      refreshExpertSelectDisabled();
      refreshOrchestratePlanSelectorDisabled();
      refreshBoardOnboardingIfMounted();
      syncViewModeToggleFromActiveChat();
      refreshViewModeToggleDisabled();
      syncComposerFromStreamingState();
    }
    if (chatFetchAbort && chatFetchAbort.signal === chatSignal) {
      setChatFetchAbort(null);
    }
    if (isStreamDomVisible(chat.id)) {
      scrollChatIfPinned();
    }
    if (
      streamCtx.wrap.isConnected &&
      streamCtx.wrap.classList.contains('msg--awaiting-prose')
    ) {
      removeOrphanStreamingRow(streamCtx.wrap, streamCtx.streamStatus);
    }
  }
  } finally {
    endChatTurnSetup(chat.id);
  }
}

/** Send the composer text with tool calling (SSE loop; max rounds from Settings → General / `chat.maxToolTurns`, default {@link MAX_TOOL_TURNS}). */
export async function sendMessageWithTools(): Promise<void> {
  if (isActiveChatStreaming()) return;
  if (isChatTurnSetupPending(getActiveChat().id)) return;
  if (isBackgroundStreamBlockingSend()) {
    setStatus('spin', 'Stop or wait for the reply in the other chat first');
    return;
  }
  const input = document.getElementById('msgInput') as HTMLTextAreaElement;
  const rawText = input.value.trim();
  const { consumePendingMessageEdit, completePendingMessageEdit } = await import(
    '../ui/message-actions'
  );
  const pendingEdit = consumePendingMessageEdit();
  if (pendingEdit) {
    input.value = '';
    input.style.height = 'auto';
    await completePendingMessageEdit(
      pendingEdit.chatId,
      pendingEdit.historyIndex,
      rawText,
    );
    return;
  }
  const pending = getPendingAttachments();
  const pendingWithoutErrors = pending.filter((a) => a.kind !== 'error');
  const chat = getActiveChat();

  if (
    orchestrateRequiresPlanBlock(
      chat.modeId,
      chat.orchestratePlanPath,
      rawText,
      pendingWithoutErrors.length,
    ) === 'block'
  ) {
    setStatus('err', 'Select a plan to orchestrate');
    return;
  }

  const slashInput = resolveOrchestrateSlashInput(
    chat.modeId,
    chat.orchestratePlanPath,
    rawText,
  );
  const { skillId, userText } = parseSlashCommand(slashInput);
  const hasUserText = Boolean(userText.trim());
  if (!rawText && pendingWithoutErrors.length === 0 && !slashInput.trim()) return;
  if (!skillId && !hasUserText && pendingWithoutErrors.length === 0) return;

  const modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  const temp = parseFloat((document.getElementById('temperature') as HTMLInputElement).value);
  const maxTok = parseInt((document.getElementById('maxTokens') as HTMLInputElement).value, 10);
  const legacySysPrompt = (
    document.getElementById('systemPrompt') as HTMLTextAreaElement
  ).value.trim();

  if (!modelId) {
    setStatus('err', 'Select a model first');
    return;
  }
  if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
    setStatus('err', 'Temperature must be 0 to 2');
    return;
  }
  if (!Number.isFinite(maxTok) || maxTok < 1) {
    setStatus('err', 'Max tokens must be at least 1');
    return;
  }
  await detectLocalServer();

  let skillBody: string | null = null;
  if (skillId) {
    const skill = await resolveActiveSkill(skillId);
    if (!skill?.body?.trim()) {
      setStatus('err', `Unknown skill: ${skillId}`);
      return;
    }
    skillBody = skill.body;
    if (skillId === IMPECCABLE_SKILL_ID) {
      skillBody = await augmentImpeccableSkillBody(skillBody, userText);
    }
  }

  const uiDesignerCtx = prepareUiDesignerTurn(chat, {
    skillId,
    userText,
    workAgentId: chat.workAgentId,
  });
  const savedWorkAgentId = chat.workAgentId;
  if (uiDesignerCtx.active) {
    chat.workAgentId = UI_DESIGNER_AGENT_ID;
  }
  if (skillBody && uiDesignerCtx.active) {
    skillBody = augmentSkillBodyForUiDesigner(skillBody, uiDesignerCtx);
  }

  if (!hasUserText && pendingWithoutErrors.length === 0 && !skillBody?.trim()) {
    setStatus('err', 'Add a message or attachment');
    if (uiDesignerCtx.active) {
      chat.workAgentId = savedWorkAgentId;
    }
    return;
  }

  const resolvedAttachments = await resolveWorkspaceReferences(pending);
  const validAttachments = resolvedAttachments.filter((a) => a.kind !== 'error');
  if (validAttachments.length === 0 && !hasUserText && !skillBody?.trim()) {
    replacePendingAttachments(resolvedAttachments);
    setStatus('err', 'Could not read attached workspace file(s)');
    if (uiDesignerCtx.active) {
      chat.workAgentId = savedWorkAgentId;
    }
    return;
  }
  replacePendingAttachments(resolvedAttachments);

  const displayText = skillId
    ? formatHistoryWithSkillTag(userText, skillId)
    : userText || rawText;
  const historyContent = buildHistoryUserContent(displayText, validAttachments);
  const titleSeed = userText || rawText || validAttachments[0]?.name || 'Attachment';
  const shouldScheduleTitle = isFirstUserMessagePending(chat);

  await runChatTurn({
    chat,
    pushUser: true,
    rawText,
    userText,
    skillId,
    displayText,
    historyContent,
    validAttachments,
    titleSeed,
    shouldScheduleTitle,
    skillBody,
  });
}
