/**
 * Tool-aware chat send path (SA-7): streams completions, runs tool_calls loop,
 * and persists assistant / tool messages in session history.
 */

import {
  chatFetchAbort,
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
  clearPendingSteer,
  consumePendingSteer,
  enqueueSteerMessage,
} from '../chat/steer-message';
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
import { recordMainChatTurnUsage } from '../usage/record-chat-usage';
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
import { buildTurnSnapshot, resolveForkHistoryIndex } from '../chat/turn-snapshot';
import type { ForkOverrides } from '../chat/fork-from-run';
import {
  createRun,
  finalizeRun,
  findRunById,
  noteRunGeneration,
  noteRunOutputIndex,
} from '../state/runs-store';
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
  TurnRunId,
  TurnSnapshot,
  UserMessage,
} from '../types';
import { markMessageStopped } from '../ui/stopped-affordance';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import {
  refreshComposerStreamingAffordance,
  setComposerStreamingMode,
  syncComposerFromStreamingState,
  syncSteerQueuedHint,
} from '../ui/composer-send';
import { registerStreamDomRemount } from './stream-chat-dom';
import {
  notifyExpertLabFirstToken,
  notifyExpertLabPartialText,
  notifyExpertLabRunEnd,
  notifyExpertLabRunError,
  notifyExpertLabRunStart,
  notifyExpertLabToolRound,
} from '../ui/expert-lab-stream';
import { isExpertLabChat } from '../state/sessions';
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
import { consumeReefArtifactEditsForPrompt } from '../chat/reef/artifact-context.ts';
import { maybePromoteToolResultToArtifact } from '../chat/reef/artifact-promotion.ts';
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
  formatGenerationErrorMessage,
  GENERATION_LOST_ON_RESTART_MESSAGE,
  subscribeToGeneration,
} from '../api/generations';
import { readProviderCapabilities } from '../providers/capability-probe';
import {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  logConstrainedDebug,
  stripResponseFormatFromBody,
} from '../providers/constrained-tool-calls';
import { mergeContentJsonToolCalls } from '../providers/constrained-tool-content';
import type { CompletionBodyWithResponseFormat } from '../providers/completion-types';
import { decodeModelSelectKey } from '../lib/model-select-key';
import { getActiveProvider } from '../providers/store';
import { isVisionModel } from '../providers/vision-model.ts';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  loadToolCallsMeta,
} from '../config/tool-calls-meta';
import { parseToolArguments } from './parse-tool-arguments';
import { setStatus } from '../ui/status';
import { applyOrchestrateAggregatedStatsToChat } from '../chat/orchestrate/stats-aggregate';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { resolveOutboundSystemMessages } from '../chat/prompts/compose-context';
import { estimateTokensFromText } from '../chat/prompts/token-estimate';
import {
  agentContextBudgetFromWorkAgent,
  applyContextBudget,
  resolveContextBudget,
} from '../chat/context-budget';
import { resolveContextLimit } from '../chat/context-usage';
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
import { resolveSamplerPreset } from '../agents/resolve-sampler';
import { applySamplerToBody } from '../agents/sampler-types';
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
  augmentCavemanSkillBody,
  CAVEMAN_SKILL_ID,
  formatHistoryWithSkillTag,
  IMPECCABLE_SKILL_ID,
  isSkillEnabled,
  normalizeCavemanUserText,
  parseSlashCommand,
  resolveActiveSkill,
  resolveTurnSkill,
} from '../skills';
import { syncComposerPinnedSkillFromActiveChat } from '../ui/composer-pinned-skill';
import {
  EMPTY_POST_TOOL_CONTINUE_INSTRUCTION,
  hasPostToolTail,
  logTurnDebug,
  MAX_PROSE_QUESTION_RETRIES,
  PROSE_QUESTION_RETRY_INSTRUCTION,
  resolveFinalAssistantContent,
  resolveTurnContinuation,
} from './turn-continuation';
import { looksLikeProseStructuredQuestion } from './prose-question-detect';
import { isToolEnabled } from './config';
import {
  DEFAULT_CHAT_MAX_TOOL_TURNS,
  getChatMetaSync,
} from '../config/chat-meta';

/** Default max assistant↔tool rounds (see Settings → Tools and `chat.maxToolTurns` in config). */
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

interface ChatCompletionBody extends CompletionBodyWithResponseFormat {
  model?: string;
  messages: ApiMessage[];
  temperature: number;
  max_tokens: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
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
  /** Replay inputs from a prior fork (regenerate / fork with model swap). */
  replaySnapshot?: TurnSnapshot;
  /** Prior run at this fork for branch lineage. */
  parentRunId?: TurnRunId;
  /** Model/provider overrides when forking without a full snapshot clone. */
  forkOverrides?: ForkOverrides;
  /** When set, replaces composed system prompt (Expert Lab expert full body). */
  composedSystemPromptOverride?: string;
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
  const vlm = isVisionModel(modelId);

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
  turnRunId?: TurnRunId,
): Promise<StreamTurnResult> {
  let generationId = resumeGenerationId;

  if (!generationId) {
    const created = await createGeneration(provider.id, body, { persist: true });
    generationId = created.generationId;
    chat.currentGenerationId = generationId;
    if (turnRunId) {
      noteRunGeneration(chat, turnRunId, generationId);
    }
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
        onEnd: (event) => {
          if (event?.status === 'error') {
            finish(() =>
              reject(new Error(event.errorMessage ?? 'Generation failed')),
            );
            return;
          }
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
  const toolCalls = mergeContentJsonToolCalls(fullText, finalizeToolCalls(toolAcc));
  const finishReason =
    streamMeta.finish_reason || (toolCalls.length > 0 ? 'tool_calls' : undefined);

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
function trackRunHistoryPush(chat: Chat, turnRunId: TurnRunId | undefined): void {
  if (!turnRunId || chat.history.length === 0) return;
  noteRunOutputIndex(chat, turnRunId, chat.history.length - 1);
}

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
    replaySnapshot,
    parentRunId,
    forkOverrides,
    composedSystemPromptOverride,
  } = options;

  if (!beginChatTurnSetup(chat.id)) {
    return;
  }

  let turnRunId: TurnRunId | undefined;
  let turnRunStatus: 'completed' | 'stopped' | 'failed' = 'completed';

  try {
  const domRaw = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  const parsedSelect = decodeModelSelectKey(domRaw);
  const domModelId = parsedSelect?.modelId ?? domRaw;
  if (parsedSelect) {
    chat.providerId = parsedSelect.providerId;
    chat.modelId = parsedSelect.modelId;
  }
  const domTemp = parseFloat((document.getElementById('temperature') as HTMLInputElement).value);
  const domMaxTok = parseInt((document.getElementById('maxTokens') as HTMLInputElement).value, 10);
  const modelId = replaySnapshot?.modelId ?? domModelId;
  const temp = replaySnapshot?.temperature ?? domTemp;
  const maxTok = replaySnapshot?.maxTokens ?? domMaxTok;
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
    const artifactAppendix = consumeReefArtifactEditsForPrompt(chat);
    const modelUserContent = artifactAppendix
      ? `${historyContent}${artifactAppendix}`
      : historyContent;
    chat.history.push({ role: 'user', content: modelUserContent });
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
  const resolvedSampler = resolveSamplerPreset({
    kind: 'work-agent',
    agentKey: activeWorkAgent?.id ?? null,
    global: { temperature: temp, maxTokens: maxTok },
  });
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

  if (isExpertLabChat(chat)) {
    notifyExpertLabRunStart(chat.id);
  }

  if (ownsGlobalStreaming) {
    setStreaming(true, chat.id);
    refreshModeSelectorDisabled();
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
  if (skillBody && skillId === CAVEMAN_SKILL_ID && !presetSkillBody) {
    skillBody = augmentCavemanSkillBody(skillBody, {
      userText,
      pinnedIntensity: chat.pinnedSkill?.intensity,
    });
  }
  if (skillBody && uiDesignerCtx.active) {
    skillBody = augmentSkillBodyForUiDesigner(skillBody, uiDesignerCtx);
  }

  const outbound = await resolveOutboundSystemMessages(chat, legacySysPrompt, {
    userMessagePreview: userText || rawText,
    routeUserText: userText || rawText,
    overrides: { skillBody },
  });
  const sysPrompt =
    options.composedSystemPromptOverride?.trim() ??
    replaySnapshot?.composedSystemPrompt ??
    outbound.composed;
  const userRulesContent = replaySnapshot?.userRulesContent ?? outbound.userRules;

  if (!resumeGenerationId) {
    const forkHistoryIndex = resolveForkHistoryIndex(chat, pushUser);
    const userRow = chat.history[forkHistoryIndex] as UserMessage | undefined;
    const userContent = userRow?.content ?? historyContent;
    const activeModeId = normalizeModeId(chat.modeId);
    let snapTools = getEnabledToolDefinitionsForMode(activeModeId);
    if (activeWorkAgent?.allowedTools?.length) {
      const allow = new Set(activeWorkAgent.allowedTools);
      snapTools = snapTools.filter((t) => allow.has(t.function.name));
    }
    snapTools = applyUiDesignerToolFilter(snapTools, uiDesignerCtx);
    const enabledToolNames = snapTools.map((t) => t.function.name);
    const maxToolTurnsCap = getChatMetaSync().maxToolTurns;

    if (replaySnapshot) {
      const run = createRun(chat, replaySnapshot, {
        parentRunId,
        parentTurnId,
        overrides: forkOverrides,
      });
      turnRunId = run.runId;
    } else {
      const snapshot = await buildTurnSnapshot({
        chat,
        forkHistoryIndex,
        composedSystemPrompt: sysPrompt,
        userRulesContent: userRulesContent ?? undefined,
        enabledToolNames,
        maxToolTurns: maxToolTurnsCap,
        providerId: sendProviderId,
        modelId: sendModelId,
        temperature: resolvedSampler.preset.temperature ?? temp,
        maxTokens: resolvedSampler.maxTokens,
        skillId,
        userContent,
      });
      const run = createRun(chat, snapshot, {
        parentRunId,
        parentTurnId,
        overrides: forkOverrides,
      });
      turnRunId = run.runId;
    }
    scheduleSaveSessions();
  }

  try {
    const provider = await getActiveProvider(sendProviderId);
    await loadToolCallsMeta();
    const providerCapabilities = await readProviderCapabilities(provider.id);
    const toolCallsMeta = getToolCallsMetaSync();
    const constrainedUserEnabled = isConstrainedDecodingEnabledForProvider(
      provider,
      toolCallsMeta,
    );
    thoughtController = new ThoughtBubbleController(wrap, thoughtPhaseCallbacks);

    const activeModeId = normalizeModeId(chat.modeId);
    let emptyPostToolRetries = 0;
    let proseQuestionRetries = 0;
    let ephemeralPostToolInstruction: string | undefined;
    const maxToolTurns = getChatMetaSync().maxToolTurns;
    const workAgentBudget = activeWorkAgent
      ? agentContextBudgetFromWorkAgent(activeWorkAgent)
      : { maxInputTokens: null, enforcementPolicy: 'slide' as const };

    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (chatSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const steerConsumed = consumePendingSteer(chat);
      if (steerConsumed.consumed) {
        syncSteerQueuedHint();
      }

      let enabledTools = getEnabledToolDefinitionsForMode(activeModeId);
      if (activeWorkAgent?.allowedTools?.length) {
        const allow = new Set(activeWorkAgent.allowedTools);
        enabledTools = enabledTools.filter((t) => allow.has(t.function.name));
      }
      enabledTools = applyUiDesignerToolFilter(enabledTools, uiDesignerCtx);
      const rawMessages = buildApiMessages(chat, sysPrompt, {
        modelId: sendModelId,
        pendingUserText: pushUser ? userText || rawText : undefined,
        composedSystemPrompt: sysPrompt,
        userRulesContent: userRulesContent ?? undefined,
        ephemeralContinueInstruction: ephemeralPostToolInstruction,
      });
      const budgetResolved = resolveContextBudget({
        agentConfig: workAgentBudget,
        modelLimit: sendModelId ? resolveContextLimit(sendModelId, chat) : null,
      });
      const budgetApplied = applyContextBudget(
        rawMessages,
        budgetResolved,
        workAgentBudget,
      );
      const messages = budgetApplied.messages;
      if (
        budgetApplied.applied &&
        budgetApplied.statusMessage &&
        isStreamDomVisible(chat.id)
      ) {
        setStatus('ok', budgetApplied.statusMessage);
      }
      const body = applySamplerToBody(
        {
          model: sendModelId || undefined,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        },
        resolvedSampler.preset,
        resolvedSampler.maxTokens,
      ) as ChatCompletionBody;
      if (enabledTools.length > 0) {
        body.tools = enabledTools;
        body.tool_choice = 'auto';
      }

      let usedConstrained = false;
      if (enabledTools.length > 0) {
        const constrainedApplied = applyConstrainedToolCallsToBody(body, {
          providerId: provider.id,
          modelId: sendModelId,
          userEnabled: constrainedUserEnabled,
          capabilities: providerCapabilities,
          enabledTools,
        });
        Object.assign(body, constrainedApplied.body);
        usedConstrained = constrainedApplied.usedConstrained;
        if (usedConstrained) {
          logConstrainedDebug('attach', {
            providerId: provider.id,
            modelId: sendModelId,
            toolCount: enabledTools.length,
          });
        }
      }

      thoughtController.setAssistantWrap(wrap);
      const domVisible = isStreamDomVisible(chat.id);

      const runStreamTurn = (turnBody: ChatCompletionBody) =>
        streamCompletionTurn(
          chat,
          provider,
          turnBody,
          resumeGenerationId,
          bubble,
          cursor,
          chatSignal,
          thoughtController,
          domVisible,
          () => {
            revealProse();
            if (isExpertLabChat(chat)) {
              notifyExpertLabFirstToken(chat.id);
            }
          },
          (text) => {
            livePartialText = text;
            if (isExpertLabChat(chat)) {
              notifyExpertLabPartialText(chat.id, text);
            }
          },
          undefined,
          turnRunId,
        );

      let turnResult: StreamTurnResult;
      try {
        turnResult = await runStreamTurn(body);
      } catch (streamErr) {
        if (usedConstrained && isResponseFormatRejectionError(streamErr)) {
          logConstrainedDebug('strip_retry', { providerId: provider.id });
          usedConstrained = false;
          turnResult = await runStreamTurn(stripResponseFormatFromBody(body));
        } else {
          throw streamErr;
        }
      }

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

      if (turnResult.toolCalls.length > 0) {
        void recordMainChatTurnUsage(chat, {
          providerId: sendProviderId,
          modelId: sendModelId,
          streamMeta: turnResult.streamMeta,
          t0: turnResult.t0,
          tFirst: turnResult.tFirst,
          tEnd: turnResult.tEnd,
          workAgentId: activeWorkAgent?.id ?? null,
        });

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
        trackRunHistoryPush(chat, turnRunId);
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
              const { args: skipArgs } = parseToolArguments(skipped.function.arguments, {
                constrained: usedConstrained,
              });
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
              trackRunHistoryPush(chat, turnRunId);
            }
            recordChatMessage(chat);
            scheduleSaveSessions();
            throw new DOMException('Aborted', 'AbortError');
          }

          const tc = turnResult.toolCalls[ti]!;
          const { args, parseError } = parseToolArguments(tc.function.arguments, {
            constrained: usedConstrained,
          });
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

          if (parseError) {
            renderToolResult(toolWrap, parseError);
            chat.history.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: parseError,
            });
            trackRunHistoryPush(chat, turnRunId);
            recordChatMessage(chat);
            scheduleSaveSessions();
            continue;
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
          const toolName = tc.function.name;
          const toolOut = planBlock
            ? { content: planBlock }
            : await executeTool(toolName, args, {
                chatId: chat.id,
                toolCallId: tc.id,
                modeId: toolLoopModeId,
                workAgentId: chat.workAgentId ?? null,
              });
          if (isExpertLabChat(chat)) {
            notifyExpertLabToolRound(chat.id, toolName);
          }
          let toolContent = toolOut.content;
          try {
            const promoted = await maybePromoteToolResultToArtifact({
              chatId: chat.id,
              chat,
              toolName: tc.function.name,
              args,
              content: toolContent,
              toolCallId: tc.id,
              modeId: toolLoopModeId,
            });
            if (promoted) {
              toolContent = `${toolContent}${promoted.footer}`;
            }
          } catch {
            /* Promotion is best-effort; never block the tool loop. */
          }

          renderToolResult(toolWrap, toolContent, toolOut.attachments, args);

          chat.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolContent,
            ...(toolOut.attachments?.length
              ? { attachments: toolOut.attachments }
              : {}),
          });
          trackRunHistoryPush(chat, turnRunId);
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
        const fallbackBody = applySamplerToBody(
          {
            model: sendModelId || undefined,
            messages,
          },
          resolvedSampler.preset,
          resolvedSampler.maxTokens,
        ) as ChatCompletionBody;
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

      const askQuestionToolAvailable =
        enabledTools.some((t) => t.function.name === 'ask_question') &&
        isToolEnabled('ask_question');
      if (
        askQuestionToolAvailable &&
        fullText.trim() &&
        looksLikeProseStructuredQuestion(fullText) &&
        proseQuestionRetries < MAX_PROSE_QUESTION_RETRIES
      ) {
        proseQuestionRetries += 1;
        ephemeralPostToolInstruction = PROSE_QUESTION_RETRY_INSTRUCTION;
        logTurnDebug({
          event: 'retry_prose_question',
          turn,
          proseQuestionRetries,
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
      void recordMainChatTurnUsage(chat, {
        providerId: sendProviderId,
        modelId: sendModelId,
        streamMeta,
        t0: turnResult.t0,
        tFirst: turnResult.tFirst,
        tEnd: turnResult.tEnd,
        workAgentId: activeWorkAgent?.id ?? null,
      });
      const displayMeta = applyOrchestrateAggregatedStatsToChat(chat, parentTurnId, meta);
      const modelInfo = resolveModelInfo(streamMeta.model || modelId, displayMeta.model_info);
      const thinkingDurationMs = thinkingTracker?.finalize() ?? 0;
      chat.lastStats = buildLastStatsSnapshot(displayMeta.stats, displayMeta.usage);
      chat.modelInfo = { ...modelInfo };
      const selVal = (document.getElementById('modelSelect') as HTMLSelectElement).value;
      const parsedVal = decodeModelSelectKey(selVal);
      chat.modelId = parsedVal?.modelId ?? selVal;
      if (parsedVal) chat.providerId = parsedVal.providerId;

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
        trackRunHistoryPush(chat, turnRunId);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        if (isExpertLabChat(chat)) {
          notifyExpertLabRunEnd(chat.id, finalContent);
        }
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
      clearPendingSteer(chat);
      turnRunStatus = 'stopped';
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
        trackRunHistoryPush(chat, turnRunId);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();
      }

      streamCtx.streamStatus.dispose();
      setStatus('ok', 'Stopped');
      return;
    }
    turnRunStatus = 'failed';
    if (isExpertLabChat(chat)) {
      notifyExpertLabRunError(
        chat.id,
        e instanceof Error ? e.message : String(e),
      );
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
          : `Could not complete this reply: ${formatGenerationErrorMessage(e.message ?? 'Unknown error')}`;
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
    if (turnRunId) {
      const run = findRunById(chat, turnRunId);
      const start = run?.outputHistoryStart;
      const end = run?.outputHistoryEnd;
      const outputMessages =
        start !== undefined && end !== undefined && end >= start
          ? chat.history.slice(start, end + 1).map((m) => ({ ...m }))
          : undefined;
      finalizeRun(chat, turnRunId, {
        status: turnRunStatus,
        outputHistoryStart: start,
        outputHistoryEnd: end,
        outputMessages,
      });
      scheduleSaveSessions();
    }
  }
  } finally {
    endChatTurnSetup(chat.id);
  }
}

/** Send the composer text with tool calling (SSE loop; max rounds from Settings → Tools / `chat.maxToolTurns`, default {@link MAX_TOOL_TURNS}). */
export async function sendMessageWithTools(): Promise<void> {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement;
  const rawTextEarly = input.value.trim();
  if (isActiveChatStreaming()) {
    if (!rawTextEarly) return;
    const pendingSteer = getPendingAttachments();
    const pendingOk = pendingSteer.filter((a) => a.kind !== 'error');
    if (pendingOk.length > 0) {
      setStatus('err', 'Steer is text only — wait for this turn to finish for attachments');
      return;
    }
    const chat = getActiveChat();
    const hadPrior = Boolean(chat.pendingSteerMessage?.trim());
    if (enqueueSteerMessage(chat, rawTextEarly)) {
      input.value = '';
      input.style.height = 'auto';
      setStatus(
        'ok',
        hadPrior
          ? 'Correction updated — applies after current step'
          : 'Steering at next step…',
      );
      refreshComposerStreamingAffordance();
      syncSteerQueuedHint();
    }
    return;
  }
  if (isChatTurnSetupPending(getActiveChat().id)) return;
  if (isBackgroundStreamBlockingSend()) {
    setStatus('spin', 'Stop or wait for the reply in the other chat first');
    return;
  }
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
  const { skillId: slashSkillId, userText: slashUserText } = parseSlashCommand(slashInput);
  const turnSkill = resolveTurnSkill({
    slashSkillId,
    userText: slashUserText,
    pinned: chat.pinnedSkill,
    isSkillEnabled,
  });
  chat.pinnedSkill = turnSkill.nextPinned;
  const skillId = turnSkill.skillId;
  let userText = normalizeCavemanUserText(skillId, slashSkillId, slashUserText);
  const hasUserText = Boolean(userText.trim());
  if (!rawText && pendingWithoutErrors.length === 0 && !slashInput.trim()) return;
  if (!skillId && !hasUserText && pendingWithoutErrors.length === 0) return;

  const rawModelSelect = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  const parsedOrchestrate = decodeModelSelectKey(rawModelSelect);
  const modelId = parsedOrchestrate?.modelId ?? rawModelSelect;
  if (parsedOrchestrate) {
    chat.providerId = parsedOrchestrate.providerId;
    chat.modelId = parsedOrchestrate.modelId;
    touchChat(chat);
  }
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
    if (skillId === CAVEMAN_SKILL_ID) {
      skillBody = augmentCavemanSkillBody(skillBody, {
        userText,
        pinnedIntensity: chat.pinnedSkill?.intensity,
      });
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

  syncComposerPinnedSkillFromActiveChat();
  scheduleSaveSessions();

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
