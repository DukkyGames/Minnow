/**
 * Tool-aware chat send path (SA-7): streams completions, runs tool_calls loop,
 * and persists assistant / tool messages in session history.
 */

import { getChatAbort, setChatAbort, setChatStopReason, setStreaming, takeChatStopReason, modelCache } from '../app-state';
import {
  beginChatTurnSetup,
  endChatTurnSetup,
  isChatTurnSetupPending,
} from '../chat/chat-turn-guard';
import {
  isActiveChatStreaming,
  isBackgroundStreamBlockingSend,
  isChatStreaming,
  isStreamDomVisible,
  notifyChatStreamEnded,
  notifyChatStreamActivity,
} from '../chat/streaming-state';
import { flushStoppedChatPresentation } from '../chat/flush-stopped-chat-presentation';
import { flushPendingMode } from '../chat/pending-mode';
import { hiddenTranscriptUserMessage } from '../chat/hidden-transcript-user-messages';
import {
  appendSuperPlanStageFailureNotice,
  superPlanPipelineUserMessage,
} from '../chat/super-plan/hidden-user-messages';
import { isSuperPlanPipelineOwningChatTurns } from '../chat/super-plan/state';
import type { SuperPlanStageId } from '../chat/super-plan/types';
import {
  clearPendingSteer,
  consumePendingSteer,
  setSteerEnqueuedListener,
} from '../chat/steer-message';
import {
  enqueueComposerMessage,
  flushPendingMessageQueue,
} from '../chat/message-queue';
import { handleGoalCommand } from '../chat/goal/command';
import { maybeContinueGoalAfterTurn, shouldEvaluateGoalAfterTurn } from '../chat/goal/evaluate';
import { handleLoopCommand } from '../chat/loop/command';
import { maybeRescheduleLoopsAfterTurn } from '../chat/loop/pacing';
import { getActiveGoal, isGoalLoopActive } from '../state/sessions';
import {
  clearAttachments,
  getPendingAttachments,
  replacePendingAttachments,
  restorePendingAttachments,
} from '../attachments/store';
import type { Attachment } from '../attachments/types';
import {
  attachmentImageDataUrl,
  attachmentsHaveImages,
} from '../attachments/attachment-image';
import { codeRefHistoryBlock, isCodeRefAttachment } from '../attachments/code-ref';
import { elementRefHistoryBlock, isElementRefAttachment } from '../attachments/element-ref';
import { designRefHistoryBlock, isDesignRefAttachment } from '../attachments/design-ref';
import { linkSentAttachmentsToTurn } from '../design/annotation-store';
import { resolveWorkspaceReferences } from '../attachments/workspace-ref';
import {
  extractStreamDelta,
  finalizeResponseMeta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  parseSsePayloads,
  type StreamMetaAccumulator,
} from '../api/chat';
import { applyClassifiedStreamEnd, classifyStreamEnd } from '../api/stream-end';
import { getLatestStreamingToolName } from '../api/tool-call-stream.ts';
import {
  foldLeadingAssistantPreamble,
  repairUnpairedToolCalls,
} from '../api/provider-message-normalize';
import { recordMainChatTurnUsage } from '../usage/record-chat-usage';
import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking,
  type RoutedContentPart,
} from '../api/inline-thinking';
import { extractReasoningDelta, extractReasoningSignatureDelta, outboundReasoningReplayFields } from '../api/reasoning';
import { resolveModelInfo } from '../api/models';
import {
  chatTurnNeedsModelLoad,
  ensureChatModelLoadedForTurn,
} from '../api/ensure-chat-model-loaded';
import { fetchCachedModels, listModelServes } from '../models/api-client';
import {
  LIBRARY_MODEL_PROVIDER_ID,
  libraryBindingNeedsServeLoad,
  loadableLibraryFromCached,
  resolveLibraryModelIdForChatBinding,
  resolveLibrarySendBinding,
  resolveUpstreamProviderId,
} from '../models/model-select-library';
import {
  cancelAssistantBubbleRenderDebounce,
  finishStreamingBubbleRender,
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
import { getBoardGroupForChat, isBoardOwnedChat, isBoardTaskChat } from '../state/chat-groups';
import {
  ensureChatHistoryLoaded,
  getActiveChat,
  scheduleSaveSessions,
  sessionState,
  touchChat,
  recordChatMessage,
  requireHistory,
} from '../state/sessions';
import { schedulePostTurnSynthesis } from '../synthesis/client';
import {
  buildSynthesisExcerpt,
  buildSynthesisMessages,
} from '../synthesis/post-turn';
import { tagApiMessageHistoryIndex } from '../chat/api-message-origin';
import { buildTurnSnapshot, resolveForkHistoryIndex } from '../chat/turn-snapshot';
import { createStreamingStatsPublisher } from '../chat/streaming-stats';
import { aggregateTurnMetaSegments } from '../chat/orchestrate/stats-math';
import type { ForkOverrides } from '../chat/fork-from-run';
import {
  createRun,
  finalizeRun,
  findRunById,
  noteRunGeneration,
  noteRunOutputIndex,
} from '../state/runs-store';
import {
  capturePostTurnSnapshot,
  capturePreTurnSnapshot,
} from '../chat/turn-snapshots';
import type {
  ApiMessage,
  ApiMessageContent,
  AssistantMessage,
  AssistantToolCallMessage,
  Chat,
  ChatCompletionChunk,
  ChatStopReason,
  ContentPart,
  Message,
  ToolCall,
  ToolCallAccumulator,
  TurnRunId,
  TurnSnapshot,
  Stats,
  Usage,
  UserImageAttachment,
  UserMessage,
} from '../types';
import { markMessageStopped } from '../ui/stopped-affordance';
import { markMessageTruncated } from '../ui/truncated-affordance';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import {
  refreshComposerStreamingAffordance,
  setComposerStreamingMode,
  syncComposerFromStreamingState,
} from '../ui/composer-send';
import { syncComposerMessageQueue } from '../ui/composer-message-queue';
import { syncGoalActiveHint } from '../ui/goal-active-hint';
import { syncLoopActiveHint } from '../ui/loop-active-hint';
import { syncTodoPanel } from '../ui/todo-panel';
import {
  clearComposerInput,
  resolveComposerSurface,
  type ComposerSurface,
} from '../ui/composer-surface';
import {
  clearComposerAfterSend,
  clearComposerDraftOnChat,
} from '../ui/composer-draft';

export type { ComposerSurface } from '../ui/composer-surface';
import { getActiveChatMountElement, setTurnChatMount } from '../ui/chat-mount';
import { registerStreamDomRemount } from './stream-chat-dom';
import { refreshModeSelectorDisabled } from '../ui/mode-selector';
import { refreshComposerReasoningEffortDisabled } from '../ui/composer-reasoning-effort';
import { refreshOrchestratePlanSelectorDisabled } from '../ui/orchestrate-plan-selector';
import {
  refreshBoardOnboardingIfMounted,
  renderBoardView,
} from '../ui/orchestrate-board';
import {
  isOrchestrateBoardInitSplitActive,
  isOrchestrateInitSplitChromeActive,
  syncOrchestrateInitSplitChrome,
} from '../ui/orchestrate-board-init-split';
import {
  refreshViewModeToggleDisabled,
  syncViewModeToggleFromActiveChat,
} from '../ui/view-mode-toggle';
import { setBugBoardExecutorContext } from './bug-board-tools';
import {
  appendBubble,
  anchorPersistedThoughtsOnRow,
  appendInjectionNoticesDom,
  appendStats,
  appendStreamingAssistantRow,
  assistantProseHasVisibleContent,
  removeOrphanStreamingRow,
  revealAssistantProseBubble,
  renderChatFromHistory,
  setAssistantErrorBubbleWithRecovery,
} from '../ui/messages';
import { completeStreamAnnouncer } from '../ui/a11y/stream-announcer';
import { refreshBranchPickerAtFork } from '../ui/branch-picker';
import { setContextInFlightOverlay } from '../chat/context-in-flight';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { ThinkingDurationTracker } from '../ui/thinking-duration';
import type { StreamingStatusHandle } from '../ui/stream-status';
import { scheduleContextUsageRefresh } from '../ui/context-usage-ring';
import {
  markChatTurnError,
  recordAssistantReplyOnChat,
  setSidebarStreamPhase,
  syncChatItemDotsInDom,
} from '../ui/chat-item-dot';
import { renderSidebar } from '../ui/sidebar';
import {
  attachToolStartIndicator,
  type ToolStartIndicatorHandle,
} from '../ui/stream-status';
import {
  cancelGeneration,
  createGeneration,
  GenerationNotFoundError,
  formatGenerationErrorMessage,
  GENERATION_LOST_ON_RESTART_MESSAGE,
  isGenerationTimeoutError,
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
import {
  ContentToolCallRouter,
  hasXmlToolCallMarkup,
  stripXmlToolCallBlocks,
} from '../providers/xml-tool-calls';
import type { CompletionBodyWithResponseFormat } from '../providers/completion-types';
import { applyModelSelectValueToChat } from '../lib/model-select-key';
import {
  resolveEffectiveChatModelBinding,
  syncPerChatModelBindingFromCatalog,
} from '../ui/default-model';
import { getActiveProvider } from '../providers/store';
import { isLocalProvider } from '../providers/provider-host';
import { acquireTickedMotion } from '../ui/motion-ticker';
import {
  canSendImagesToModel,
  isImageRejectionError,
  isVisionModel,
  recordImageRejection,
} from '../providers/vision-model.ts';
import { bodyHasImageParts, stripImagePartsFromBody } from '../api/image-parts';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  loadToolCallsMeta,
} from '../config/tool-calls-meta';
import { setStatus } from '../ui/status';
import { applyOrchestrateAggregatedStatsToChat } from '../chat/orchestrate/stats-aggregate';
import {
  refreshMetricsStripForChat,
  shouldUseBoardAggregateStats,
} from '../chat/orchestrate/board-stats-aggregate';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { resolveOutboundSystemMessages } from '../chat/prompts/compose-context';
import { estimateTokensFromText } from '../chat/prompts/token-estimate';
import {
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
  agentContextBudgetFromWorkAgent,
} from '../chat/context-budget';
import { applyContextPolicy } from '../chat/context/apply-policy';
import { appendContextNoticeIfNeeded } from '../chat/context/context-notice';
import {
  appendInjectionNoticesForTurn,
  isUiOnlyTranscriptMessage,
} from '../chat/context/injection-notice';
import { handleCompressCommand } from '../chat/context/compress-command';
import { resolveWorkAgentContextPolicy } from '../chat/resolve-context-policy';
import {
  applyArchivePolicy,
  applyMemoizedCollapse,
  reportArchiveDisabled,
  type ArchivePreResult,
} from '../chat/archive';
import { resolveContextLimit } from '../chat/context-usage';
import {
  TOOL_IMAGE_NO_VISION_HINT,
  toolImageFollowUpUserMessage,
  toolMessageHasImageAttachment,
  USER_IMAGE_NO_VISION_HINT,
} from '../chat/tool-image-follow-up';
import { pushOutboundSystemMessages } from './api-system-messages';
import { normalizeModeId } from '../chat/modes/types';
import {
  orchestrateRequiresPlanBlock,
  resolveOrchestrateSlashInput,
} from '../chat/orchestrate/send-gate';
import { resolveEffectiveOrchestratePlanPathWithSync } from '../chat/orchestrate/plan-path-sync';
import { resolveActiveWorkAgent } from '../agents/resolve-work-agent';
import { resolveWorkAgentBinding } from '../agents/resolve-work-agent-binding';
import { UI_DESIGNER_AGENT_ID } from '../agents/ui-designer/constants';
import { resolveUiDesignerBinding } from '../agents/ui-designer/config';
import {
  applyUiDesignerToolFilter,
  augmentSkillBodyForUiDesigner,
  prepareUiDesignerTurn,
} from '../agents/ui-designer/runner';
import { WorkAgentConfigError } from '../agents/work-agent-types';
import { getUserWorkAgentOverride } from '../agents/work-agent-registry';
import { mergeThinkingIntoCompletionBody } from '../agents/merge-thinking-body';
import { resolveThinkingMode, resolveThinkingBudgetTokens } from '../agents/resolve-thinking';
import {
  ThinkingBudgetTracker,
  buildBudgetContinuationMessages,
  buildThinkingPrefillAssistantMessage,
  stripCarriedTextEcho,
  stripPrefillEchoFromDelta,
} from '../agents/thinking-budget';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../providers/types';
import {
  modelUsesComposerReasoningDropdown,
  resolveEffectiveReasoningEffort,
} from '../lib/reasoning-effort';
import { resolveSamplerPreset } from '../agents/resolve-sampler';
import { mergeGlobalSamplerWithLibraryModel } from '../config/library-inference-meta';
import { readGlobalSamplerForSend } from '../config/sampler-meta';
import { applySamplerToBody } from '../agents/sampler-types';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { resolveSendCapabilities } from '../providers/model-capabilities';
import {
  cancelAllForParentTurn,
} from '../agents/orchestrator';
import { createSubAgentRunId } from '../agents/sub-agent-run-id';
import {
  detectLocalServer,
  getEnabledToolDefinitionsForChat,
} from './client';
import { setBoardExecutorContext } from './board-tools';
import { setSubAgentExecutorContext } from './sub-agent-executor';
import {
  copyHistoryForOutboundApi,
  clearPostToolTailBeforeSend,
  repairSessionHistoryTail,
  rollbackFailedTurnHistory,
  turnProducedOutput,
} from '../chat/history';
import { indexOfLastUserMessage } from '../chat/history-truncate-core';
import {
  composeImpeccableSkillBody,
  shouldComposeImpeccableBody,
  augmentCavemanSkillBody,
  augmentPartyModeSkillBody,
  CAVEMAN_SKILL_ID,
  PARTYMODE_SKILL_ID,
  GIT_SETUP_SKILL_ID,
  prepareGitSetupTurn,
  formatHistoryWithSkillTag,
  isPartyModePinned,
  isSkillEnabled,
  normalizeCavemanUserText,
  parseSlashCommand,
  resolveActiveSkill,
  resolveTurnSkill,
} from '../skills';
import { syncComposerPinnedSkillFromActiveChat } from '../ui/composer-pinned-skill';
import { burstPartyConfetti } from '../ui/party-confetti';
import { getPickerAppliedSkillId } from '../ui/skill-picker';
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
import { runChatToolBatch } from './chat-tool-batch';

/** Options for {@link buildApiMessages} when the composer has pending files. */
export interface BuildApiMessagesOptions {
  /** Active model id (used to detect VLM for multimodal user content). */
  modelId?: string;
  /** When set, overrides vision detection for screenshot follow-ups. */
  vision?: boolean;
  /** Raw user text from the composer for the in-flight turn (not history placeholders). */
  pendingUserText?: string;
  /** Pre-composed system prompt (Step 04); overrides legacy sysPrompt when set. */
  composedSystemPrompt?: string;
  /** Second system message: global user rules (Feature 24). */
  userRulesContent?: string;
  /** Ephemeral user line after an empty post-tool model reply (not stored in history). */
  ephemeralContinueInstruction?: string;
  /** Surface-owned context injected as a system message without persisting in history. */
  ephemeralContext?: string;
  /**
   * Attachments belonging to this turn. Defaults to the composer's pending list only for
   * callers that have not resolved their own set — the running turn always passes its own
   * so the composer strip can be emptied at send time instead of at turn end (MIN-650).
   */
  attachments?: Attachment[];
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
  presence_penalty?: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: ReturnType<typeof getEnabledToolDefinitionsForChat>;
  tool_choice?: 'auto';
}

/** History placeholder for an image attachment (persisted in UserMessage.content). */
function imageHistoryPlaceholder(name: string): string {
  return `[image: ${name}]`;
}

const IMAGE_PLACEHOLDER_IN_HISTORY_RE = /\[image:\s*[^\]]+\]/i;

/** User row that should receive pending image_url parts (not a later steer line). */
function indexOfMultimodalUserMessage(
  history: Message[],
  pending: Attachment[],
): number {
  const hasPendingImages = attachmentsHaveImages(pending);
  if (!hasPendingImages) {
    return indexOfLastUserMessage(history);
  }
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'user' && IMAGE_PLACEHOLDER_IN_HISTORY_RE.test(m.content)) {
      return i;
    }
  }
  return indexOfLastUserMessage(history);
}

/** Skip ask_question prose retry when this turn includes image input. */
function turnHasImageContext(chat: Chat, pending: Attachment[]): boolean {
  if (attachmentsHaveImages(pending)) {
    return true;
  }
  for (const m of chat.history) {
    if (m.role === 'user' && IMAGE_PLACEHOLDER_IN_HISTORY_RE.test(m.content)) {
      return true;
    }
  }
  return false;
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
    if (isCodeRefAttachment(att)) {
      parts.push(
        codeRefHistoryBlock(
          att.workspacePath,
          att.lineStart,
          att.lineEnd,
          att.text,
        ),
      );
      continue;
    }
    if (isElementRefAttachment(att)) {
      parts.push(
        elementRefHistoryBlock({
          selector: att.selector,
          uid: att.uid ?? null,
          pageUrl: att.pageUrl,
          tagName: att.tagName,
          classList: att.classList,
          rect: att.rect,
          stylesDigest: att.stylesDigest,
          outerHtmlPreview: att.outerHtmlPreview,
          imageName: att.croppedDataUrl ? att.name : undefined,
          sourceMapping: att.sourceMapping,
          accessibleName: att.accessibleName,
          contrastRatio: att.contrastRatio,
          domPath: att.domPath,
          attributes: att.attributes,
          computedStyles: att.computedStyles,
        }),
      );
      if (att.croppedDataUrl) parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if (isDesignRefAttachment(att)) {
      parts.push(
        designRefHistoryBlock({
          shape: att.shape,
          pageUrl: att.pageUrl,
          intentText: att.intentText,
          imageName: att.compositedDataUrl ? att.name : undefined,
        }),
      );
      if (att.compositedDataUrl) parts.push(imageHistoryPlaceholder(att.name));
      continue;
    }
    if ((att.kind === 'text' || att.kind === 'pdf') && att.text) {
      parts.push(fileContentBlock(att.name, att.text));
    }
  }

  return parts.join('\n\n');
}

/**
 * Non-VLM API payload: one string with text, file blocks, and image placeholders.
 *
 * A bare `[image: shot.png]` reads to the model like a file it should go fetch,
 * so it answers "I don't have an image tool" instead of saying it cannot see.
 * Spell out what actually happened whenever pixels were dropped.
 */
function buildStringUserApiContent(
  userText: string,
  attachments: Attachment[],
): string {
  const content = buildHistoryUserContent(userText, attachments);
  if (!attachmentsHaveImages(attachments)) return content;
  return `${content}${USER_IMAGE_NO_VISION_HINT}`;
}

/** VLM API payload: text part plus image_url parts (no image placeholders in text). */
export function buildVlmUserApiContent(
  userText: string,
  attachments: Attachment[],
): ContentPart[] {
  const textParts: string[] = [];
  const trimmed = userText.trim();
  if (trimmed) textParts.push(trimmed);

  for (const att of attachments) {
    if (att.kind === 'error' || att.kind === 'image') continue;
    if (isCodeRefAttachment(att)) {
      textParts.push(
        codeRefHistoryBlock(
          att.workspacePath,
          att.lineStart,
          att.lineEnd,
          att.text,
        ),
      );
      continue;
    }
    if (isElementRefAttachment(att)) {
      textParts.push(
        elementRefHistoryBlock({
          selector: att.selector,
          uid: att.uid ?? null,
          pageUrl: att.pageUrl,
          tagName: att.tagName,
          classList: att.classList,
          rect: att.rect,
          stylesDigest: att.stylesDigest,
          outerHtmlPreview: att.outerHtmlPreview,
          imageName: att.croppedDataUrl ? att.name : undefined,
          sourceMapping: att.sourceMapping,
          accessibleName: att.accessibleName,
          contrastRatio: att.contrastRatio,
          domPath: att.domPath,
          attributes: att.attributes,
          computedStyles: att.computedStyles,
        }),
      );
      continue;
    }
    if (isDesignRefAttachment(att)) {
      textParts.push(
        designRefHistoryBlock({
          shape: att.shape,
          pageUrl: att.pageUrl,
          intentText: att.intentText,
          imageName: att.compositedDataUrl ? att.name : undefined,
        }),
      );
      continue;
    }
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
    const url = attachmentImageDataUrl(att);
    if (!url) continue;
    parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: trimmed || '' });
  }

  return parts;
}

/**
 * Ceiling on image bytes stored per user row. Sessions are one JSON blob, so a
 * handful of 4K screenshots would make every save rewrite tens of megabytes;
 * over the cap the turn still sends the pixels, they just are not persisted.
 */
const MAX_PERSISTED_IMAGE_BYTES = 6 * 1024 * 1024;

/** Composer attachments → the image records stored on the pushed user row. */
export function persistableUserImages(
  attachments: Attachment[],
): UserImageAttachment[] {
  const out: UserImageAttachment[] = [];
  let bytes = 0;
  for (const att of attachments) {
    const dataUrl = attachmentImageDataUrl(att);
    if (!dataUrl?.startsWith('data:image/')) continue;
    bytes += dataUrl.length;
    if (bytes > MAX_PERSISTED_IMAGE_BYTES) break;
    out.push({ name: att.name, dataUrl });
  }
  return out;
}

/**
 * Most recent persisted user images replayed per request. Every replayed image
 * costs its full token price on every later turn, so an old screenshot must not
 * quietly eat the context window for the rest of the chat.
 */
const MAX_REPLAYED_HISTORY_IMAGES = 6;

/**
 * History rows whose persisted images should ride along as `image_url` parts.
 * Walks newest-first so the budget is spent on what the user just asked about,
 * and skips the row that already receives the in-flight composer attachments.
 */
function historyImageReplayIndices(
  history: Message[],
  multimodalUserIdx: number,
): Set<number> {
  const indices = new Set<number>();
  let budget = MAX_REPLAYED_HISTORY_IMAGES;
  for (let i = history.length - 1; i >= 0 && budget > 0; i -= 1) {
    if (i === multimodalUserIdx) continue;
    const m = history[i];
    if (m.role !== 'user') continue;
    const count = m.images?.length ?? 0;
    if (count === 0) continue;
    indices.add(i);
    budget -= count;
  }
  return indices;
}

/** Persisted user row → multimodal content so the model can re-read the pixels. */
function replayUserImageContent(message: UserMessage): ApiMessageContent {
  const parts: ContentPart[] = [];
  if (message.content.trim()) {
    parts.push({ type: 'text', text: message.content });
  }
  for (const image of message.images ?? []) {
    if (!image.dataUrl?.startsWith('data:image/')) continue;
    parts.push({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } });
  }
  if (parts.length === 0) return message.content;
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
  /** Run title job after the first turn completes (avoids competing with main chat for TTFT). */
  deferTitleUntilTurnEnd?: boolean;
  /** First user message in chat (capture before history.push). */
  firstUserSend?: boolean;
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
  /** Push user text to history without showing a user bubble (sub-agent completion resume). */
  suppressUserEcho?: boolean;
  /** Super Plan controller stage — stamps history and hides the user bubble from the transcript. */
  superPlanStage?: SuperPlanStageId;
  /** Turn started by /goal or goal auto-continuation (triggers post-turn evaluator). */
  goalDriven?: boolean;
  /** Composer input/send override (defaults to foreground app surface). */
  composerSurface?: Partial<ComposerSurface>;
  /** Surface-owned context reused across every round of this turn only. */
  ephemeralContext?: string;
  /** First model round only: ephemeral user line for API (not stored in history). */
  ephemeralContinueInstruction?: string;
}

/**
 * Serialize session history for LM Studio, including tool_calls and tool results.
 * Pending attachments on the last user turn become multimodal API content (VLM) or
 * inlined file blocks; history stays string-only with `[image: …]` placeholders.
 * Tool screenshots keep a string tool result (OpenAI pairing) and, on vision models,
 * a follow-up user message with `image_url` data URLs so the model can see the PNG.
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
  const ephemeralContext = options?.ephemeralContext?.trim();
  if (ephemeralContext) {
    messages.push({ role: 'system', content: ephemeralContext });
  }

  const pending = (options?.attachments ?? getPendingAttachments()).filter(
    (a) => a.kind !== 'error',
  );
  const outboundHistory = copyHistoryForOutboundApi(chat.history);
  const multimodalUserIdx = indexOfMultimodalUserMessage(outboundHistory, pending);
  const modelId = options?.modelId;
  // Tool screenshots are injected by Minnow, so they stay conservative: a wasted
  // 400 mid-tool-loop is worse than a text-only result. Images the user attached
  // by hand get the benefit of the doubt — see `canSendImagesToModel`.
  const vlm = options?.vision ?? isVisionModel(modelId);
  const sendUserImages = options?.vision ?? canSendImagesToModel(modelId);
  const replayIndices = sendUserImages
    ? historyImageReplayIndices(outboundHistory, multimodalUserIdx)
    : new Set<number>();

  // Record where each row lands so archive collapse can address history rows by
  // identity instead of guessing at `systemEnd + i` (see api-message-origin.ts).
  const pushFromHistory = (message: ApiMessage, historyIndex: number): void => {
    tagApiMessageHistoryIndex(message, historyIndex);
    messages.push(message);
  };

  for (let i = 0; i < outboundHistory.length; i += 1) {
    const m = outboundHistory[i];
    if (isUiOnlyTranscriptMessage(m)) continue;
    if (m.role === 'user') {
      const isMultimodalUser = i === multimodalUserIdx;
      if (isMultimodalUser && pending.length > 0) {
        const userText = options?.pendingUserText ?? m.content;
        const content: ApiMessageContent = sendUserImages
          ? buildVlmUserApiContent(userText, pending)
          : buildStringUserApiContent(userText, pending);
        pushFromHistory({ role: 'user', content }, i);
      } else if (replayIndices.has(i)) {
        pushFromHistory({ role: 'user', content: replayUserImageContent(m) }, i);
      } else {
        pushFromHistory({ role: 'user', content: m.content }, i);
      }
      continue;
    }

    if (m.role === 'tool') {
      const hasImage = toolMessageHasImageAttachment(m);
      pushFromHistory(
        {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content:
            hasImage && !vlm ? `${m.content}${TOOL_IMAGE_NO_VISION_HINT}` : m.content,
        },
        i,
      );
      if (vlm) {
        const followUp = toolImageFollowUpUserMessage(m);
        // The follow-up carries no history row of its own; it rides with the tool result.
        if (followUp) messages.push(followUp);
      }
      continue;
    }

    if (m.role === 'assistant') {
      const withTools = m as AssistantToolCallMessage;
      if (withTools.tool_calls?.length) {
        const reasoningText = withTools.thinking?.join('\n\n').trim() ?? '';
        pushFromHistory(
          {
            role: 'assistant',
            content: withTools.content ?? null,
            tool_calls: withTools.tool_calls,
            ...outboundReasoningReplayFields(
              modelId ?? '',
              reasoningText,
              withTools.thinkingSignature,
              { toolCallTurn: true },
            ),
          },
          i,
        );
      } else {
        pushFromHistory({ role: 'assistant', content: m.content }, i);
      }
    }
  }

  const continueLine = options?.ephemeralContinueInstruction?.trim();
  if (continueLine) {
    messages.push({ role: 'user', content: continueLine });
  }

  return repairUnpairedToolCalls(foldLeadingAssistantPreamble(messages));
}

interface StreamTurnResult {
  fullText: string;
  streamMeta: StreamMetaAccumulator;
  t0: number;
  tFirst: number | null;
  tEnd: number;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
  thinkingBudgetExceeded?: boolean;
  partialThinkingText?: string;
  /** Channel the reasoning actually arrived on, when any was seen. */
  thinkingChannel?: 'native' | 'inline';
  endStatus?: 'complete' | 'error' | 'cancelled';
}

interface StreamCompletionTurnOptions {
  thinkingBudgetTracker?: ThinkingBudgetTracker | null;
  /** Strip provider echo of prefilled thinking on the first content delta. */
  prefillEchoPartial?: string;
  /** Prose already streamed before a budget continuation — seeds `fullText` so it isn't lost. */
  carriedText?: string;
  /** Fired on each SSE chunk so metrics can update mid-stream (MIN-413). */
  onStreamProgress?: (state: {
    streamMeta: StreamMetaAccumulator;
    t0: number;
    tFirst: number | null;
    partialText: string;
    partialThinking: string;
  }) => void;
}

/**
 * Stream one completion via backend-owned generation (POST + subscribe, or subscribe-only).
 */
async function streamCompletionTurn(
  chat: Chat,
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
  body: ChatCompletionBody,
  resumeGenerationId: string | undefined,
  getStreamDom: () => { bubble: HTMLDivElement; cursor: HTMLDivElement },
  signal: AbortSignal,
  thoughtController: ThoughtBubbleController | null,
  isDomVisible: () => boolean,
  onFirstProseDelta?: () => void,
  onPartialText?: (fullText: string) => void,
  onToolCallStreaming?: (toolName: string) => void,
  onStreamConnected?: () => void,
  onStreamContextActivity?: () => void,
  turnRunId?: TurnRunId,
  streamOptions?: StreamCompletionTurnOptions,
): Promise<StreamTurnResult> {
  let generationId = resumeGenerationId;

  if (!generationId) {
    const created = await createGeneration(provider.id, body, {
      persist: true,
      fallbackRole: 'main-chat',
      chatId: chat.id,
    });
    generationId = created.generationId;
    chat.currentGenerationId = generationId;
    if (turnRunId) {
      noteRunGeneration(chat, turnRunId, generationId);
    }
    scheduleSaveSessions();
  }

  const carriedText = streamOptions?.carriedText ?? '';
  let fullText = carriedText;
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  let lastAnnouncedToolName = '';
  const t0 = performance.now();
  let tFirst: number | null = null;
  const modelId = body.model ?? '';
  const inlineRouter = new InlineContentThinkingRouter({
    thinkingModel: modelLikelyUsesInlineThinking(modelId),
  });
  const harmonyRouter = new HarmonyChannelRouter();
  const toolCallRouter = new ContentToolCallRouter();
  // Second capture for the inline-thinking channel: Qwen3.8 interleaved thinking emits
  // `<tool_call>` *before* `</think>`, so without this the call is swallowed as reasoning
  // and no tool ever runs (the model then retries until the generation overflows).
  const thinkingToolCallRouter = new ContentToolCallRouter();
  const thinkingBudgetTracker = streamOptions?.thinkingBudgetTracker ?? null;
  let prefillEchoPartial = streamOptions?.prefillEchoPartial?.trim() ?? '';
  let carriedEchoPending = carriedText.trim().length > 0;
  let toolCallPhaseStarted = false;
  let budgetTripped = false;
  let thinkingChannel: 'native' | 'inline' | undefined;
  let generationEndStatus: 'complete' | 'error' | 'cancelled' | undefined;

  if (carriedText) {
    // Re-render what the aborted attempt already showed so the bubble never blanks.
    onFirstProseDelta?.();
    onPartialText?.(fullText);
    if (isDomVisible()) {
      const { bubble, cursor } = getStreamDom();
      scheduleAssistantBubbleRender(bubble, fullText, cursor);
    }
  }

  function feedThinkingBudget(delta: string): void {
    if (!thinkingBudgetTracker || !delta) return;
    thinkingBudgetTracker.feed(delta);
  }

  function noteThinkingChannel(channel: 'native' | 'inline'): void {
    thinkingChannel ??= channel;
  }

  function processRoutedParts(parts: RoutedContentPart[]): void {
    for (const [text, isThinking] of parts) {
      if (text && tFirst == null) tFirst = performance.now();
      if (isThinking) {
        if (text) {
          noteThinkingChannel('inline');
          // A `<tool_call>` block inside the think span is withheld from the bubble and
          // kept for post-stream parsing instead of rendering as reasoning prose.
          emitThinking(thinkingToolCallRouter.feed(text));
          onStreamContextActivity?.();
        }
        continue;
      }
      if (!text) {
        continue;
      }
      thinkingBudgetTracker?.endSession();
      thoughtController?.endReasoningPhase();
      // `<tool_call>` markup (Qwen via mlx-lm) is withheld here so it never renders as prose.
      emitProse(toolCallRouter.feed(text));
      onStreamContextActivity?.();
    }
  }

  function emitThinking(text: string): void {
    if (!text) {
      return;
    }
    feedThinkingBudget(text);
    thoughtController?.appendReasoningDelta(text);
  }

  function emitProse(text: string): void {
    if (!text) {
      return;
    }
    onFirstProseDelta?.();
    fullText += text;
    onPartialText?.(fullText);
    if (isDomVisible()) {
      const { bubble, cursor } = getStreamDom();
      scheduleAssistantBubbleRender(bubble, fullText, cursor);
    }
  }

  function routeContentDelta(delta: string): void {
    if (!delta) {
      return;
    }
    for (const [harmonyText, isHarmonyThinking] of harmonyRouter.feed(delta)) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          noteThinkingChannel('inline');
          feedThinkingBudget(harmonyText);
          thoughtController?.appendReasoningDelta(harmonyText);
          onStreamContextActivity?.();
        }
        continue;
      }
      processRoutedParts(inlineRouter.feed(harmonyText));
    }
  }

  function flushContentRouters(): void {
    for (const [harmonyText, isHarmonyThinking] of harmonyRouter.flush()) {
      if (isHarmonyThinking) {
        if (harmonyText) {
          noteThinkingChannel('inline');
          feedThinkingBudget(harmonyText);
          thoughtController?.appendReasoningDelta(harmonyText);
          onStreamContextActivity?.();
        }
        continue;
      }
      processRoutedParts(inlineRouter.feed(harmonyText));
    }
    processRoutedParts(inlineRouter.flush());
    emitThinking(thinkingToolCallRouter.flush());
    emitProse(toolCallRouter.flush());
  }

  function emitStreamProgress(): void {
    streamOptions?.onStreamProgress?.({
      streamMeta,
      t0,
      tFirst,
      partialText: fullText,
      partialThinking: thoughtController?.getJoinedDisplayText() ?? '',
    });
  }

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoning = extractReasoningDelta(chunk);
    if (reasoning) {
      noteThinkingChannel('native');
      // First output token may be native reasoning — start tok/s timing here, not only on prose.
      if (tFirst == null) tFirst = performance.now();
      feedThinkingBudget(reasoning);
      thoughtController?.appendReasoningDelta(reasoning);
      onStreamContextActivity?.();
    }
    const reasoningSignature = extractReasoningSignatureDelta(chunk);
    if (reasoningSignature) {
      thoughtController?.appendReasoningSignature(reasoningSignature);
      onStreamContextActivity?.();
    }
    const contentDelta = extractStreamDelta(chunk);
    if (contentDelta) {
      let routedDelta = contentDelta;
      if (prefillEchoPartial) {
        routedDelta = stripPrefillEchoFromDelta(routedDelta, prefillEchoPartial);
        prefillEchoPartial = '';
      }
      if (carriedEchoPending) {
        routedDelta = stripCarriedTextEcho(routedDelta, carriedText);
        carriedEchoPending = false;
      }
      routeContentDelta(routedDelta);
    }
    // Reasoning ends before tool_calls JSON streams; stop the thinking timer here (MIN-467).
    if (Object.keys(toolAcc).length > 0) {
      if (!toolCallPhaseStarted) {
        toolCallPhaseStarted = true;
        // Bank the phase once, at the boundary — later chunks must not clear a fresh trip.
        thinkingBudgetTracker?.endSession();
      }
      thoughtController?.endReasoningPhase();
    }
    // Not gated on visibility: the name is announced once per round, and a chat the
    // user returns to mid-call still needs it. The listener decides what to paint.
    if (onToolCallStreaming) {
      const streamingName = getLatestStreamingToolName(toolAcc);
      if (streamingName && streamingName !== lastAnnouncedToolName) {
        lastAnnouncedToolName = streamingName;
        onToolCallStreaming(streamingName);
      }
    }
    emitStreamProgress();
    if (isDomVisible()) {
      scrollChatIfPinned();
    }
  }

  /** End the live generation early so push-now steer can run at the tool-loop boundary. */
  let finishStreamEarly: (() => void) | null = null;

  function maybeFinishForSteer(): void {
    if (!chat.pendingSteerMessage?.trim()) return;
    finishStreamEarly?.();
  }

  function maybeFinishForBudget(): void {
    if (!thinkingBudgetTracker?.exceeded || budgetTripped) return;
    budgetTripped = true;
    finishStreamEarly?.();
  }

  function handleChunkWithSteerCheck(chunk: ChatCompletionChunk): void {
    handleChunk(chunk);
    maybeFinishForSteer();
    if (!budgetTripped) {
      maybeFinishForBudget();
    }
  }

  // Decode and the renderer share one GPU, and a CSS animation costs a compositor frame
  // every vsync for as long as it runs — several tok/s, measurably, on a local serve. Step
  // the working indicators down to 8 Hz for the length of the stream. Not gated on
  // `isDomVisible()`: a background chat still spins a ring in the rail. No-op for cloud
  // providers, where there is no local decode to protect.
  const releaseTickedMotion = isLocalProvider(provider) ? acquireTickedMotion() : null;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      let unsubscribe = (): void => {};

      finishStreamEarly = (): void => {
        unsubscribe();
        void cancelGeneration(generationId!);
        finish(resolve);
      };

      setSteerEnqueuedListener((steerChatId) => {
        if (steerChatId === chat.id) {
          maybeFinishForSteer();
        }
      });

      unsubscribe = subscribeToGeneration(generationId!, {
        signal,
        onStreamOpen: onStreamConnected,
        onChunk: handleChunkWithSteerCheck,
        onEnd: (event) => {
          if (event?.status) {
            generationEndStatus = event.status;
          }
          if (event?.status === 'error') {
            const message = event.errorMessage ?? '';
            if (isGenerationTimeoutError(message)) {
              setChatStopReason(chat.id, 'timeout');
              finish(() => reject(new DOMException('Aborted', 'AbortError')));
              return;
            }
            finish(() =>
              reject(new Error(event.errorMessage ?? 'Generation failed')),
            );
            return;
          }
          if (event?.status === 'cancelled') {
            finish(() => reject(new DOMException('Aborted', 'AbortError')));
            return;
          }
          if (event?.fallbackUsed && event.chosenProviderId) {
            const modelLabel = event.chosenModelId?.trim() || '(request model)';
            setStatus(
              'ok',
              `Replied via fallback provider ${event.chosenProviderId} · ${modelLabel}`,
            );
          }
          finish(resolve);
        },
        onTransportError: (err) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        },
        onAbort: () => {
          finish(() => reject(new DOMException('Aborted', 'AbortError')));
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
      // A failed cancel must not mask the abort: the caller's AbortError branch
      // is what clears `currentGenerationId`, so swallowing it here would leave
      // the chat stuck as "running" in the agent activity panel.
      await cancelGeneration(generationId!).catch(() => {
        /* best-effort; the stream reader is already torn down */
      });
      throw err;
    }
    throw err;
  } finally {
    releaseTickedMotion?.();
    finishStreamEarly = null;
    setSteerEnqueuedListener(null);
  }

  flushContentRouters();
  onPartialText?.(fullText);

  thoughtController?.endReasoningPhase();

  const split = extractInlineThinkingFromContent(fullText);
  if (split.thinking.length && split.reply.trim()) {
    thoughtController?.ingestCompletedReasoning(split.thinking.join('\n\n'));
    fullText = split.reply;
    onPartialText?.(fullText);
  }

  const tEnd = performance.now();
  const toolCalls = mergeContentJsonToolCalls(fullText, finalizeToolCalls(toolAcc), {
    harmonyParseText: harmonyRouter.getCommentaryParseText(),
    xmlParseText: toolCallRouter.getToolCallParseText(),
    // Thinking-side markup: the streamed think span, plus a block the post-stream split
    // just moved out of `fullText` and into reasoning.
    thinkingXmlParseText: [
      thinkingToolCallRouter.getToolCallParseText(),
      ...split.thinking,
    ].join('\n'),
  });
  // Carried/resumed text bypasses the router; drop markup only once it parsed as a call.
  if (toolCalls.length > 0 && hasXmlToolCallMarkup(fullText)) {
    fullText = stripXmlToolCallBlocks(fullText);
    onPartialText?.(fullText);
  }
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
    thinkingBudgetExceeded: budgetTripped,
    partialThinkingText: budgetTripped ? thinkingBudgetTracker?.sessionText : undefined,
    thinkingChannel,
    endStatus: generationEndStatus,
  };
}

/**
 * Run the tool-aware SSE loop for one user turn (optionally skip pushing a new user row).
 */
function trackRunHistoryPush(chat: Chat, turnRunId: TurnRunId | undefined): void {
  if (!turnRunId || chat.history.length === 0) return;
  noteRunOutputIndex(chat, turnRunId, chat.history.length - 1);
}

/** Push in-flight stream snapshot into context ring estimate (BUG-019). */
function syncTurnContextUsage(
  chatId: string,
  livePartialText: string,
  thoughtController: ThoughtBubbleController | null,
  pendingToolCallsJson?: string,
): void {
  const partial = livePartialText.trim();
  const thinkingText = thoughtController?.getJoinedDisplayText().trim() ?? '';
  const hasOverlay = Boolean(partial || thinkingText || pendingToolCallsJson);
  setContextInFlightOverlay(
    hasOverlay
      ? {
          chatId,
          ...(partial ? { partialAssistantText: partial } : {}),
          ...(thinkingText ? { thinkingText } : {}),
          ...(pendingToolCallsJson ? { pendingToolCallsJson } : {}),
        }
      : null,
  );
  scheduleContextUsageRefresh({ duringStream: true });
}

interface FinalizedThinkingRound {
  segments: string[];
  durationMs: number;
}

/** Consume one response's reasoning segments and anchor them on its assistant row. */
function finalizeAndAnchorThinkingRound(opts: {
  thoughtController: ThoughtBubbleController | null;
  thinkingTracker: ThinkingDurationTracker | null;
  wrap: HTMLElement;
  streamStatus: StreamingStatusHandle;
  domVisible: boolean;
  hasProse: boolean;
}): FinalizedThinkingRound {
  const segments = opts.thoughtController?.consumePersistedSegments() ?? [];
  const durationMs = opts.thinkingTracker?.finalizeRound() ?? 0;
  if (opts.domVisible) {
    if (segments.length > 0) {
      if (opts.hasProse) {
        renderThoughtsToggle(opts.wrap, segments, {
          durationMs: durationMs > 0 ? durationMs : undefined,
        });
      } else {
        anchorPersistedThoughtsOnRow(opts.wrap, segments, {
          durationMs: durationMs > 0 ? durationMs : undefined,
          streamStatus: opts.streamStatus,
        });
      }
    } else if (!opts.hasProse) {
      removeOrphanStreamingRow(opts.wrap, opts.streamStatus);
    }
  }
  return { segments, durationMs };
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
    deferTitleUntilTurnEnd = false,
    firstUserSend: firstUserSendOption,
    skillBody: presetSkillBody = null,
    resumeGenerationId,
    ownsGlobalStreaming = true,
    replaySnapshot,
    parentRunId,
    forkOverrides,
    composedSystemPromptOverride,
    suppressUserEcho = false,
    superPlanStage,
    goalDriven = false,
    ephemeralContext,
    ephemeralContinueInstruction,
  } = options;

  const hideUserEcho = suppressUserEcho || Boolean(superPlanStage);

  // Category-3: hydrate full history before any absolute-index / mutate work (archive, push).
  await ensureChatHistoryLoaded(chat.id);
  requireHistory(chat);

  if (!beginChatTurnSetup(chat.id)) {
    return;
  }

  let turnRunId: TurnRunId | undefined;
  let turnRunStatus: 'completed' | 'stopped' | 'failed' = 'completed';
  let turnStopReason: ChatStopReason | undefined;
  let turnEndReason: 'max_tool_turns' | undefined;
  let turnErrorMessage: string | undefined;
  let turnMountPinned = false;
  let turnTeardownRan = false;

  try {
    if (skillId === GIT_SETUP_SKILL_ID && !resumeGenerationId) {
      await prepareGitSetupTurn();
    }
  const useActiveChatDom = chat.id === getActiveChat().id;
  // Capture the correct DOM mount now so mid-turn navigation (e.g. launch_minnow_app
  // routing to the Code app) cannot re-route stream output to the wrong surface.
  if (useActiveChatDom) {
    setTurnChatMount(getActiveChatMountElement());
    turnMountPinned = true;
  }
  if (replaySnapshot) {
    // Replay must use the provider/model frozen in the turn snapshot, not the top-bar picker.
    chat.providerId = replaySnapshot.providerId;
    chat.modelId = replaySnapshot.modelId;
  } else if (chat.modelId?.trim()) {
    syncPerChatModelBindingFromCatalog(chat);
  } else {
    const binding = resolveEffectiveChatModelBinding(chat);
    if (binding.selectValue) {
      applyModelSelectValueToChat(chat, binding.selectValue);
    } else if (binding.modelId) {
      chat.modelId = binding.modelId;
      if (binding.providerId) {
        chat.providerId = binding.providerId;
      }
    }
  }
  const modelId = replaySnapshot?.modelId ?? chat.modelId?.trim() ?? '';
  const globalSampler = mergeGlobalSamplerWithLibraryModel(
    readGlobalSamplerForSend(
      replaySnapshot
        ? {
            temperature: replaySnapshot.temperature,
            maxTokens: replaySnapshot.maxTokens,
          }
        : undefined,
    ),
    modelId,
  );
  const legacySysPrompt = (
    document.getElementById('systemPrompt') as HTMLTextAreaElement
  ).value.trim();

  getChatAbort(chat.id)?.abort();
  const controller = new AbortController();
  setChatAbort(chat.id, controller);
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

  if (normalizeModeId(chat.modeId) === 'orchestrate') {
    const board = getBoardGroupForChat(chat)?.orchestrateBoard;
    if (board) {
      board.activeParentTurnId = parentTurnId;
      touchChat(chat);
      scheduleSaveSessions();
    }
  }

  chat.modelId = modelId || chat.modelId;

  const firstUserSendForInjections = pushUser
    ? (firstUserSendOption ?? isFirstUserMessagePending(chat))
    : false;

  if (pushUser) {
    if (clearPostToolTailBeforeSend(chat)) {
      scheduleSaveSessions();
    }
    clearComposerDraftOnChat(chat);
    const pushedUserRow: Message =
      superPlanStage
        ? superPlanPipelineUserMessage(historyContent, superPlanStage)
        : hideUserEcho
          ? hiddenTranscriptUserMessage(historyContent)
          : { role: 'user', content: historyContent };
    // Persist the bytes, not just the `[image: name]` marker: without this the
    // transcript loses its thumbnails on reload and the model can never look at
    // the image again after the turn it was attached on.
    const persistedImages = persistableUserImages(validAttachments);
    if (pushedUserRow.role === 'user' && persistedImages.length > 0) {
      pushedUserRow.images = persistedImages;
    }
    chat.history.push(pushedUserRow);
    recordChatMessage(chat);
    scheduleSaveSessions();
    syncTurnContextUsage(chat.id, '', null);
    const pushedUserIdx = chat.history.length - 1;
    if (validAttachments.length > 0) {
      // MIN-368: stamp every sent designRef (Draw tool) attachment's shape with a link back to
      // this turn. `turnId` is the pushed message's history index (as a string) — the same
      // `data-history-index` identity messages.ts/message-actions.ts already stamp on every
      // rendered row, so both link directions agree on what a "turn" is.
      void linkSentAttachmentsToTurn(chat.id, String(pushedUserIdx), validAttachments);
    }
    if (!hideUserEcho) {
      renderSidebar();
      if (isStreamDomVisible(chat.id)) {
        const userIdx = pushedUserIdx;
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
      }
      if (useActiveChatDom) {
        clearComposerInput(
          resolveComposerSurface(options.composerSurface).inputEl,
        );
      }
    }
  }

  const activeWorkAgent = resolveActiveWorkAgent(chat);
  const resolvedSampler = resolveSamplerPreset({
    kind: 'work-agent',
    agentKey: activeWorkAgent?.id ?? null,
    global: globalSampler,
  });
  const resolvedThinking = replaySnapshot
    ? { mode: replaySnapshot.thinkingMode, sourceLabel: 'replay' }
    : resolveThinkingMode({
        kind: 'work-agent',
        agentKey: activeWorkAgent?.id ?? null,
        chatThinkingMode: chat.thinkingMode,
      });
  const resolvedThinkingBudget = resolveThinkingBudgetTokens({
    kind: 'work-agent',
    agentKey: activeWorkAgent?.id ?? null,
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
    const initialSendProvider = await getActiveProvider(chat.providerId);
    if (uiDesignerCtx.active) {
      const binding = await resolveUiDesignerBinding(chat, {
        providerId: initialSendProvider.id,
        modelId: sendModelId,
      });
      sendModelId = binding.modelId;
      sendProviderId = binding.providerId;
    } else {
      const binding = await resolveWorkAgentBinding(
        activeWorkAgent,
        chat,
        { providerId: initialSendProvider.id, modelId: sendModelId },
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
      const boardTaskId = chat.boardTaskId?.trim();
      const boardGroupId = chat.boardGroupId?.trim();
      if (boardTaskId && boardGroupId && sessionState) {
        const group = sessionState.groups?.find((g) => g.id === boardGroupId);
        if (group?.orchestrateBoard) {
          void import('../state/orchestrate-board-store.ts').then(({ updateTask }) => {
            updateTask(group, boardTaskId, { error: err.message });
          });
        }
      }
      return;
    }
    throw err;
  }

  chat.modelId = sendModelId;
  chat.providerId = sendProviderId;

  // My Models: keep minnow-library + gguf:/mlx: for ensure; remap to llama/mlx only after a live serve.
  // Soft-fail cached/serves so resume and offline turns still run when the models API is down.
  const cached = await fetchCachedModels().catch(() => []);
  const library = await loadableLibraryFromCached(cached);
  const serves = await listModelServes().catch(() => []);
  const libraryModelId = resolveLibraryModelIdForChatBinding(
    chat.providerId,
    chat.modelId,
    library,
  );
  const libraryChatTurn = libraryModelId != null;
  /** Library ids passed to ensure — must not be remapped before load. */
  let libraryEnsure: { providerId: string; modelId: string } | null = null;
  let pendingModelLoad: boolean;

  if (libraryChatTurn) {
    libraryEnsure = { providerId: LIBRARY_MODEL_PROVIDER_ID, modelId: libraryModelId };
    // Live serve status — modelCache alone is stale after eject.
    pendingModelLoad = libraryBindingNeedsServeLoad(
      libraryModelId,
      library,
      serves,
      modelCache,
    );
    const served = resolveLibrarySendBinding(libraryModelId, library, serves);
    if (served) {
      sendProviderId = served.providerId;
      sendModelId = served.modelId;
    } else {
      // Upstream provider for getActiveProvider / caps; completions remap after ensure.
      sendProviderId = resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, libraryModelId);
      const libRow = library.find((m) => m.id === libraryModelId);
      if (libRow?.format === 'MLX' && libRow.path?.trim() && sendModelId.trim().startsWith('mlx:')) {
        sendModelId = libRow.path.trim();
      }
    }
  } else {
    pendingModelLoad = false;
  }

  const sendProvider = await getActiveProvider(sendProviderId);
  if (!libraryChatTurn) {
    pendingModelLoad = chatTurnNeedsModelLoad(sendProvider, sendModelId);
  }
  const sendCaps = resolveSendCapabilities(sendProviderId, sendModelId, sendProvider.apiKind);
  const turnReasoningEffort =
    replaySnapshot?.reasoningEffort ??
    (modelUsesComposerReasoningDropdown(sendCaps)
      ? resolveEffectiveReasoningEffort(chat, sendCaps, resolvedThinking.mode)
      : undefined);

  const mainTurnLabel = uiDesignerCtx.active
    ? 'UI Designer'
    : activeWorkAgent?.label?.trim() || 'Main turn';
  const turnStartedAtMs = Date.now();
  emitMainTurnActivity({
    chatId: chat.id,
    phase: pendingModelLoad ? 'loading_model' : 'generating',
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
    if (pushUser && chat.boardTaskId) {
      const { markBoardTaskInProgressFromChat } = await import(
        '../state/orchestrate-board-store'
      );
      markBoardTaskInProgressFromChat(chat);
    }
    setStreaming(true, chat.id);
    syncOrchestrateInitSplitChrome(chat);
    if (
      !hideUserEcho &&
      pushUser &&
      isOrchestrateBoardInitSplitActive(chat)
    ) {
      const userIdx = chat.history.length - 1;
      const userRow = chat.history[userIdx];
      if (userRow?.role === 'user') {
        const { wrap: userWrap } = appendBubble(
          'user',
          userRow.content,
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
      }
    }
    if (isStreamDomVisible(chat.id)) {
      refreshModeSelectorDisabled();
      refreshComposerReasoningEffortDisabled();
      refreshOrchestratePlanSelectorDisabled();
      refreshBoardOnboardingIfMounted();
      refreshViewModeToggleDisabled();
      setComposerStreamingMode('streaming');
    } else {
      syncComposerFromStreamingState();
    }
  }
  let livePartialText = '';
  const streamingStatsPublisher = createStreamingStatsPublisher(chat);
  const turnUsageSegments: Usage[] = [];
  const turnStatsSegments: Array<{ stats: Stats; usage: Usage }> = [];
  const pushLiveStreamingStats = (state: {
    streamMeta: StreamMetaAccumulator;
    t0: number;
    tFirst: number | null;
    partialText: string;
    partialThinking: string;
  }): void => {
    streamingStatsPublisher.schedule({
      ...state,
      priorSegments: turnUsageSegments,
      priorStatsSegments: turnStatsSegments,
      modelId: sendModelId,
      modelInfo: chat.modelInfo ?? undefined,
    });
  };
  if (isStreamDomVisible(chat.id)) {
    setStatus(
      'spin',
      pendingModelLoad
        ? 'Loading model…'
        : uiDesignerCtx.active
          ? `${uiDesignerCtx.statusHint}…`
          : `Generating reply${agentStatusSuffix}…`,
    );
  }

  let streamRow = appendStreamingAssistantRow(chat.id);
  let { wrap, bubble, cursor, streamStatus } = streamRow;
  if (pendingModelLoad) {
    if (isStreamDomVisible(chat.id)) {
      streamStatus.setPhase('loading_model');
    }
    setSidebarStreamPhase('loading_model', chat.id);
  } else {
    setSidebarStreamPhase('generating', chat.id);
  }
  const streamCtx = { wrap, streamStatus };
  // Track prose-awaiting without DOM class — stub rows in board view omit msg--awaiting-prose.
  let awaitingProse = true;
  let toolStartIndicator: ToolStartIndicatorHandle | null = null;
  /**
   * Tool whose arguments are still streaming, kept for the remount path.
   *
   * The stream announces a tool name once per round (`lastAnnouncedToolName`), so a
   * shell that mounts after the announcement has no second chance to learn it — and a
   * long argument stream (a file write carries the whole file) leaves the user staring
   * at a bare caret for the rest of the call.
   */
  let streamingToolName: string | null = null;
  const showToolStartIndicator = (toolName: string): void => {
    if (!toolName.trim()) return;
    // Remember it even while hidden — this is what the remount path replays.
    streamingToolName = toolName;
    if (!isStreamDomVisible(chat.id)) return;
    if (!toolStartIndicator) {
      toolStartIndicator = attachToolStartIndicator({
        wrap,
        bubble,
        cursor,
        streamStatus,
      });
    }
    toolStartIndicator.show(toolName);
  };
  /** Round boundary: the pending call is finished, so drop the name with the row. */
  const resetToolStartIndicator = (): void => {
    toolStartIndicator?.dispose();
    toolStartIndicator = null;
    streamingToolName = null;
  };
  let revealProse = (): void => {
    awaitingProse = false;
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
    // The handle died with the previous shell; the name is re-applied below.
    toolStartIndicator?.dispose();
    toolStartIndicator = null;
    awaitingProse = true;
    revealProse = (): void => {
      awaitingProse = false;
      if (!isStreamDomVisible(chat.id)) return;
      revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
    };
    thoughtController?.setAssistantWrap(wrap);
    if (livePartialText.trim() && isStreamDomVisible(chat.id)) {
      // Replay already-streamed prose onto the new shell so the caret is not
      // left on an empty revealed bubble while tokens keep painting a detached node.
      revealProse();
      scheduleAssistantBubbleRender(bubble, livePartialText, cursor);
    }
    // Last, so it wins over the caret and stream-status the replay above reveals.
    if (streamingToolName) {
      showToolStartIndicator(streamingToolName);
    }
  });

  thinkingTracker = new ThinkingDurationTracker((elapsedMs) => {
    if (isStreamDomVisible(chat.id)) {
      thoughtController?.setThinkingElapsed(elapsedMs);
    }
  });

  const thoughtPhaseCallbacks = {
    onThinkingStart: (): void => {
      patchMainTurnActivity(chat.id, { phase: 'thinking', currentTool: null });
      if (isStreamDomVisible(chat.id)) {
        streamCtx.streamStatus.setPhase('thinking');
      }
      setSidebarStreamPhase('thinking', chat.id);
      thinkingTracker?.startSegment();
    },
    onReasoningEnded: (): void => {
      thinkingTracker?.endSegment();
      if (isStreamDomVisible(chat.id)) {
        streamCtx.streamStatus.setThinkingElapsed(null);
        if (awaitingProse) {
          streamCtx.streamStatus.setPhase('generating');
          setSidebarStreamPhase('generating', chat.id);
        } else {
          setSidebarStreamPhase(null, chat.id);
        }
      } else if (awaitingProse) {
        patchMainTurnActivity(chat.id, { phase: 'generating', currentTool: null });
        setSidebarStreamPhase('generating', chat.id);
      } else {
        setSidebarStreamPhase(null, chat.id);
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
  if (skillBody && shouldComposeImpeccableBody(skillId, userText) && !presetSkillBody) {
    skillBody = await composeImpeccableSkillBody(skillBody, userText);
  }
  if (skillBody && skillId === CAVEMAN_SKILL_ID && !presetSkillBody) {
    skillBody = augmentCavemanSkillBody(skillBody, {
      userText,
      pinnedIntensity: chat.pinnedSkill?.intensity,
    });
  }
  if (skillBody && skillId === PARTYMODE_SKILL_ID && !presetSkillBody) {
    skillBody = augmentPartyModeSkillBody(skillBody);
  }
  if (skillBody && uiDesignerCtx.active) {
    skillBody = augmentSkillBodyForUiDesigner(skillBody, uiDesignerCtx);
  }

  const outbound = await resolveOutboundSystemMessages(chat, legacySysPrompt, {
    userMessagePreview: userText || rawText,
    routeUserText: userText || rawText,
    attachmentWorkspacePaths: validAttachments
      .map((a) => a.workspacePath?.trim())
      .filter((p): p is string => Boolean(p)),
    firstUserSend: firstUserSendForInjections,
    overrides: { skillBody },
  });
  const sysPrompt =
    options.composedSystemPromptOverride?.trim() ??
    replaySnapshot?.composedSystemPrompt ??
    outbound.composed;
  const userRulesContent = replaySnapshot?.userRulesContent ?? outbound.userRules;

  if (pushUser) {
    const injectionAdded = appendInjectionNoticesForTurn(
      chat,
      outbound.injectionBlocks,
    );
    if (injectionAdded.length > 0) {
      scheduleSaveSessions();
      if (isStreamDomVisible(chat.id)) {
        appendInjectionNoticesDom(
          injectionAdded,
          chat.history.length - injectionAdded.length,
          { chatId: chat.id },
        );
      }
    }
  }

  if (!resumeGenerationId) {
    const forkHistoryIndex = resolveForkHistoryIndex(chat, pushUser);
    const userRow = chat.history[forkHistoryIndex] as UserMessage | undefined;
    const userContent = userRow?.content ?? historyContent;
    const activeModeId = normalizeModeId(chat.modeId);
    let snapTools = getEnabledToolDefinitionsForChat(chat, { skillId });
    if (activeWorkAgent?.allowedTools?.length) {
      const allow = new Set(activeWorkAgent.allowedTools);
      snapTools = snapTools.filter((t) => allow.has(t.function.name));
    }
    snapTools = applyUiDesignerToolFilter(snapTools, uiDesignerCtx);
    const enabledToolNames = snapTools.map((t) => t.function.name);

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
        providerId: sendProviderId,
        modelId: sendModelId,
        temperature:
          resolvedSampler.preset.temperature ??
          globalSampler.preset.temperature ??
          0.7,
        maxTokens: resolvedSampler.maxTokens,
        thinkingMode: resolvedThinking.mode,
        reasoningEffort: turnReasoningEffort,
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
    // MIN-409: dangling WT snapshot before tools mutate files (best-effort).
    if (turnRunId) {
      await capturePreTurnSnapshot(chat, turnRunId);
    }
    scheduleSaveSessions();
  }

  let synthesisRoundCount = 0;
  let synthesisToolCount = 0;

  /*
   * MIN-650: the composer strip empties the moment the turn owns the files, the same way
   * the text input does — `validAttachments` is this turn's transport from here on, so the
   * global pending list no longer has to survive until teardown. Kept as a snapshot only to
   * hand the files back if the turn fails or is stopped, so a retry does not re-attach by hand.
   *
   * Guarded exactly like `clearComposerInput` above: the pending list is one global strip
   * shared by every surface, so a background or sub-agent turn must not empty the composer
   * of whatever chat the user is actually looking at.
   */
  const ownsComposer = pushUser && !hideUserEcho && useActiveChatDom;
  const sentAttachments = ownsComposer ? getPendingAttachments() : [];
  if (sentAttachments.length > 0) {
    clearAttachments();
  }

  try {
    let provider = await getActiveProvider(sendProviderId);
    await loadToolCallsMeta();
    let providerCapabilities = await readProviderCapabilities(provider.id);
    const toolCallsMeta = getToolCallsMetaSync();
    const constrainedUserEnabled = isConstrainedDecodingEnabledForProvider(
      provider,
      toolCallsMeta,
    );
    thoughtController = new ThoughtBubbleController(wrap, thoughtPhaseCallbacks);

    const activeModeId = normalizeModeId(chat.modeId);
    let emptyPostToolRetries = 0;
    let proseQuestionRetries = 0;
    let ephemeralPostToolInstruction: string | undefined = ephemeralContinueInstruction;
    const workAgentBudget = activeWorkAgent
      ? agentContextBudgetFromWorkAgent(
          activeWorkAgent,
          resolveWorkAgentContextPolicy(activeWorkAgent.id),
        )
      : { enforcementPolicy: DEFAULT_CONTEXT_ENFORCEMENT_POLICY };

    // Boot resume subscribes once; later tool-loop rounds must POST new generations (MIN-187).
    let activeResumeGenerationId = resumeGenerationId;
    let archiveMemo: ArchivePreResult | null = null;

    const prepareNextStreamRound = (statusHint: string): void => {
      streamRow = appendStreamingAssistantRow(chat.id);
      ({ wrap, bubble, cursor, streamStatus } = streamRow);
      streamCtx.wrap = wrap;
      streamCtx.streamStatus = streamStatus;
      lastWrap = wrap;
      resetToolStartIndicator();
      awaitingProse = true;
      revealProse = (): void => {
        awaitingProse = false;
        if (!isStreamDomVisible(chat.id)) return;
        revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
      };
      thoughtController?.setAssistantWrap(wrap);
      thoughtController?.resetStreamPhaseHints();
      if (isStreamDomVisible(chat.id)) {
        setStatus('spin', statusHint);
      }
      patchMainTurnActivity(chat.id, { phase: 'generating', currentTool: null });
    };

    let modelLoadDone = !pendingModelLoad;
    // Budget is per user turn, not per tool-loop iteration — one tracker for the whole loop.
    let turnThinkingBudgetTracker: ThinkingBudgetTracker | null = null;
    let turnBudgetContinuationAttempts = 0;

    for (let turn = 0; ; turn++) {
      if (chatSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (!modelLoadDone) {
        // Ensure with library ids so loadLibraryModelFromPicker runs (not remapped llama/mlx).
        const ensureProviderId = libraryEnsure?.providerId ?? sendProviderId;
        const ensureModelId = libraryEnsure?.modelId ?? sendModelId;
        await ensureChatModelLoadedForTurn(ensureProviderId, ensureModelId, chatSignal);

        if (libraryEnsure) {
          const cached = await fetchCachedModels().catch(() => []);
          const library = await loadableLibraryFromCached(cached);
          const serves = await listModelServes().catch(() => []);
          const served = resolveLibrarySendBinding(libraryEnsure.modelId, library, serves);
          if (!served) {
            throw new Error(
              'Failed to load My Models model — no running serve after load',
            );
          }
          sendProviderId = served.providerId;
          sendModelId = served.modelId;
        }

        // Provider row may not exist until serve (e.g. mlx-lm-local); re-resolve after load.
        provider = await getActiveProvider(sendProviderId);
        providerCapabilities = await readProviderCapabilities(provider.id);

        modelLoadDone = true;
        patchMainTurnActivity(chat.id, { phase: 'generating' });
        if (isStreamDomVisible(chat.id)) {
          streamStatus.setPhase('generating');
          setStatus(
            'spin',
            uiDesignerCtx.active
              ? `${uiDesignerCtx.statusHint}…`
              : `Generating reply${agentStatusSuffix}…`,
          );
        }
        setSidebarStreamPhase('generating', chat.id);
      }

      const steerConsumed = consumePendingSteer(chat);
      if (steerConsumed.consumed) {
        syncComposerMessageQueue();
      }

      let enabledTools = getEnabledToolDefinitionsForChat(chat, { skillId });
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
        ephemeralContext,
        attachments: validAttachments,
      });

      let preMessages = rawMessages;
      if (workAgentBudget.enforcementPolicy === 'archive') {
        try {
          if (turn === 0) {
            archiveMemo = await applyArchivePolicy(rawMessages, {
              chat,
              agentConfig: workAgentBudget,
            });
            preMessages = archiveMemo.messages;
            chat.lastContextTrim = {
              archived: archiveMemo.archived,
              recalled: archiveMemo.recalled,
              recallTokens: archiveMemo.recallTokens,
            };
          } else if (archiveMemo) {
            preMessages = applyMemoizedCollapse(
              rawMessages,
              archiveMemo,
              chat.history.length,
            );
          }
        } catch (err) {
          reportArchiveDisabled(err);
          preMessages = rawMessages;
        }
      }

      const budgetApplied = await applyContextPolicy({
        messages: preMessages,
        policy: workAgentBudget.enforcementPolicy,
        modelLimit: sendModelId ? resolveContextLimit(sendModelId, chat) : null,
        agentConfig: workAgentBudget,
        providerId: sendProviderId,
        modelId: sendModelId,
        signal: chatSignal,
        onStatus: (level, message) => {
          if (isStreamDomVisible(chat.id)) setStatus(level, message);
        },
      });
      const messages = budgetApplied.messages;
      if (budgetApplied.applied) {
        if (budgetApplied.droppedTurns > 0 || budgetApplied.summaryInjected) {
          appendContextNoticeIfNeeded(chat, {
            policy: budgetApplied.policy,
            droppedTurns: budgetApplied.droppedTurns,
            summaryText: budgetApplied.summaryText,
          });
          chat.lastContextTrim = {
            policy: budgetApplied.policy,
            droppedTurns: budgetApplied.droppedTurns,
            summaryPreview: budgetApplied.summaryText?.slice(0, 200),
            at: Date.now(),
          };
        }
        if (budgetApplied.statusMessage && isStreamDomVisible(chat.id)) {
          setStatus('ok', budgetApplied.statusMessage);
        }
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
      const llamaSupportsThinkingBudget =
        provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
        providerCapabilities?.supportsThinkingBudget === true;
      const thinkingModeForSend = replaySnapshot?.thinkingMode ?? resolvedThinking.mode;
      const { nativeBudgetApplied } = mergeThinkingIntoCompletionBody(
        body as unknown as Record<string, unknown>,
        thinkingModeForSend,
        provider,
        sendCaps,
        replaySnapshot?.reasoningEffort ?? turnReasoningEffort,
        undefined,
        resolvedThinkingBudget.budgetTokens,
        { llamaSupportsThinkingBudget },
      );
      let thinkingBudgetTracker: ThinkingBudgetTracker | null = null;
      if (
        resolvedThinkingBudget.budgetTokens != null &&
        !nativeBudgetApplied &&
        thinkingModeForSend === 'on'
      ) {
        turnThinkingBudgetTracker ??= new ThinkingBudgetTracker(
          resolvedThinkingBudget.budgetTokens,
        );
        thinkingBudgetTracker = turnThinkingBudgetTracker;
      }
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

      const runStreamTurn = (
        turnBody: ChatCompletionBody,
        streamOpts?: StreamCompletionTurnOptions,
      ) =>
        streamCompletionTurn(
          chat,
          provider,
          turnBody,
          activeResumeGenerationId,
          () => ({ bubble, cursor }),
          chatSignal,
          thoughtController,
          // Live check, not a per-round snapshot: the user can leave and come back
          // mid-round, and the shell they come back to is a different one.
          () => isStreamDomVisible(chat.id),
          () => {
            revealProse();
          },
          (text) => {
            livePartialText = text;
          },
          (toolName) => {
            showToolStartIndicator(toolName);
          },
          undefined,
          () => {
            syncTurnContextUsage(chat.id, livePartialText, thoughtController);
            notifyChatStreamActivity(chat.id);
          },
          turnRunId,
          {
            ...streamOpts,
            onStreamProgress: (state) => {
              pushLiveStreamingStats(state);
              streamOpts?.onStreamProgress?.(state);
            },
          },
        );

      const runStreamTurnWithThinkingBudget = async (): Promise<StreamTurnResult> => {
        let currentBody = body;
        const tracker = thinkingBudgetTracker;
        let prefillPartial = '';
        let carriedText = '';
        let carriedThinking = '';
        const maxContinuations = 2;
        const streamOpts = (): StreamCompletionTurnOptions => ({
          thinkingBudgetTracker: tracker,
          prefillEchoPartial: prefillPartial || undefined,
          carriedText: carriedText || undefined,
        });

        while (true) {
          let turnResult: StreamTurnResult;
          try {
            turnResult = await runStreamTurn(currentBody, streamOpts());
          } catch (streamErr) {
            const streamMessage =
              streamErr instanceof Error ? streamErr.message : String(streamErr);
            const transientFetch =
              streamErr instanceof TypeError && streamMessage.includes('Failed to fetch');
            if (transientFetch) {
              await new Promise((r) => setTimeout(r, 400));
              turnResult = await runStreamTurn(currentBody, streamOpts());
            } else if (usedConstrained && isResponseFormatRejectionError(streamErr)) {
              logConstrainedDebug('strip_retry', { providerId: provider.id });
              usedConstrained = false;
              currentBody = stripResponseFormatFromBody(currentBody);
              turnResult = await runStreamTurn(currentBody, streamOpts());
            } else if (
              bodyHasImageParts(currentBody) &&
              isImageRejectionError(streamErr)
            ) {
              // Minnow sends attached pixels to any model that has not been
              // *proven* text-only. This is where that bet is settled: drop the
              // images, tell the model why, and remember so the next turn on
              // this model skips the wasted round-trip entirely.
              recordImageRejection(sendModelId);
              currentBody = stripImagePartsFromBody(currentBody);
              if (isStreamDomVisible(chat.id)) {
                setStatus('err', 'Model rejected the image — resent without it');
              }
              turnResult = await runStreamTurn(currentBody, streamOpts());
            } else {
              throw streamErr;
            }
          }

          if (
            !turnResult.thinkingBudgetExceeded ||
            !tracker ||
            turnBudgetContinuationAttempts >= maxContinuations
          ) {
            // The escalation only runs once per turn — later rounds must not be cut again.
            if (turnBudgetContinuationAttempts > 0) tracker?.disarm();
            return turnResult;
          }

          turnBudgetContinuationAttempts += 1;
          // The cut generation is cancelled; a continuation must POST a new one, not resume it.
          activeResumeGenerationId = undefined;
          // The tracker holds the tripping phase only — keep earlier phases from this turn too.
          const partialThinking = [carriedThinking, turnResult.partialThinkingText ?? '']
            .filter((part) => part.trim())
            .join('\n\n');
          carriedThinking = partialThinking;
          // `carriedText` was seeded into the stream, so `fullText` is already cumulative.
          const partialText = turnResult.fullText;
          const isFinalAttempt = turnBudgetContinuationAttempts >= maxContinuations;

          if (!isFinalAttempt) {
            // Trust the channel the reasoning actually arrived on; guess only when none was seen.
            const canPrefill =
              turnResult.thinkingChannel === 'inline' ||
              (turnResult.thinkingChannel == null &&
                (modelLikelyUsesInlineThinking(sendModelId) ||
                  (provider.id === LLAMA_CPP_LOCAL_PROVIDER_ID &&
                    !llamaSupportsThinkingBudget)));
            // Prefill carries thinking only, so prose has to go through the payload builder.
            const usePrefill = canPrefill && !partialText.trim();
            currentBody = {
              ...body,
              messages: [
                ...messages,
                ...(usePrefill
                  ? [buildThinkingPrefillAssistantMessage(partialThinking)]
                  : buildBudgetContinuationMessages({ partialThinking, partialText })),
              ],
            };
            prefillPartial = usePrefill ? partialThinking : '';
            carriedText = partialText;
            tracker.beginContinuation();
            setStatus('ok', 'Thinking budget reached — continuing to answer');
            continue;
          }

          const continuationBody = applySamplerToBody(
            {
              model: sendModelId || undefined,
              messages: [
                ...messages,
                ...buildBudgetContinuationMessages({ partialThinking, partialText }),
              ],
              stream: true,
              stream_options: { include_usage: true },
            },
            resolvedSampler.preset,
            resolvedSampler.maxTokens,
          ) as ChatCompletionBody;
          mergeThinkingIntoCompletionBody(
            continuationBody as unknown as Record<string, unknown>,
            'off',
            provider,
            sendCaps,
            replaySnapshot?.reasoningEffort ?? turnReasoningEffort,
          );
          if (enabledTools.length > 0) {
            continuationBody.tools = enabledTools;
            continuationBody.tool_choice = 'auto';
          }
          currentBody = continuationBody;
          prefillPartial = '';
          carriedText = partialText;
          tracker.disarm();
          setStatus('ok', 'Thinking budget reached — answering without extended reasoning');
        }
      };

      let turnResult: StreamTurnResult;
      turnResult = await runStreamTurnWithThinkingBudget();

      if (activeResumeGenerationId) {
        activeResumeGenerationId = undefined;
      }

      cancelAssistantBubbleRenderDebounce();
      resetToolStartIndicator();
      finishStreamingBubbleRender(bubble, cursor);

      const finishReason =
        turnResult.finishReason ||
        (turnResult.toolCalls.length > 0 ? 'tool_calls' : undefined);

      const streamEnd = classifyStreamEnd({
        finishReason,
        toolCallsCount: turnResult.toolCalls.length,
        textLength: turnResult.fullText.trim().length,
        streamError: turnResult.streamMeta.error,
        endStatus: turnResult.endStatus,
      });

      const lastHistoryRole = chat.history[chat.history.length - 1]?.role;
      logTurnDebug({
        turn,
        endKind: streamEnd.kind,
        finishReason: finishReason ?? null,
        toolCalls: turnResult.toolCalls.length,
        fullTextLen: turnResult.fullText.length,
        lastHistoryRole: lastHistoryRole ?? null,
        emptyPostToolRetries,
      });

      if (streamEnd.kind !== 'complete' && streamEnd.kind !== 'truncated') {
        void import('../boot/report-background-error.js').then((mod) => {
          mod.reportBackgroundError('stream-end-abnormal', {
            kind: streamEnd.kind,
            providerId: sendProviderId,
            modelId: sendModelId,
            finishReason: finishReason ?? null,
            textLength: turnResult.fullText.trim().length,
            round: turn,
          });
        });
      }

      const { truncated: streamTruncated } = applyClassifiedStreamEnd(streamEnd, {
        hasPostToolTail: hasPostToolTail(chat.history),
        textLength: turnResult.fullText.trim().length,
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
        const toolRoundMeta = finalizeResponseMeta(
          turnResult.streamMeta,
          turnResult.t0,
          turnResult.tFirst ?? turnResult.tEnd,
          turnResult.tEnd,
        );
        if (toolRoundMeta.usage && Object.keys(toolRoundMeta.usage).length > 0) {
          turnUsageSegments.push(toolRoundMeta.usage);
          turnStatsSegments.push({
            stats: toolRoundMeta.stats,
            usage: toolRoundMeta.usage,
          });
          streamingStatsPublisher.schedule({
            streamMeta: {},
            t0: turnResult.t0,
            tFirst: turnResult.tFirst,
            partialText: '',
            partialThinking: '',
            priorSegments: turnUsageSegments,
            priorStatsSegments: turnStatsSegments,
            modelId: sendModelId,
            modelInfo: chat.modelInfo ?? undefined,
          });
        }

        const toolProse = turnResult.fullText.trim();
        const hasToolProse = Boolean(toolProse);
        if (hasToolProse && isStreamDomVisible(chat.id)) {
          revealProse();
          setAssistantBubbleContent(bubble, toolProse, { streaming: false, modeId: chat.modeId });
        }

        const thinkingSignature = thoughtController?.getAnthropicThinkingSignature();
        const { segments: thinkingNorm, durationMs: thinkingDurationMs } =
          finalizeAndAnchorThinkingRound({
            thoughtController,
            thinkingTracker,
            wrap,
            streamStatus,
            domVisible: isStreamDomVisible(chat.id),
            hasProse: hasToolProse,
          });
        const assistantToolMsg: AssistantToolCallMessage = {
          role: 'assistant',
          content: toolProse || null,
          tool_calls: turnResult.toolCalls,
          ...(thinkingNorm.length > 0 ? { thinking: thinkingNorm } : {}),
          ...(thinkingDurationMs > 0 ? { thinkingDurationMs } : {}),
          ...(thinkingSignature ? { thinkingSignature } : {}),
        };
        syncTurnContextUsage(
          chat.id,
          livePartialText,
          thoughtController,
          JSON.stringify(turnResult.toolCalls),
        );
        chat.history.push(assistantToolMsg);
        syncTurnContextUsage(chat.id, livePartialText, thoughtController);
        trackRunHistoryPush(chat, turnRunId);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();
        if (isStreamDomVisible(chat.id)) {
          setStatus('spin', 'Running tools…');
        }
        patchMainTurnActivity(chat.id, { phase: 'tools' });

        synthesisRoundCount += 1;
        synthesisToolCount += turnResult.toolCalls.length;

        const paintToolCallsInChat = isStreamDomVisible(chat.id);

        await runChatToolBatch({
          chat,
          toolCalls: turnResult.toolCalls,
          signal: chatSignal,
          constrained: usedConstrained,
          paintInChat: paintToolCallsInChat,
          parentTurnId,
          turnRunId,
          uiDesignerActive: uiDesignerCtx.active,
          uiDesignerMode: uiDesignerCtx.mode,
          livePartialText,
          thoughtController,
          syncContextUsage: (pendingToolCallsJson) =>
            syncTurnContextUsage(
              chat.id,
              livePartialText,
              thoughtController,
              pendingToolCallsJson,
            ),
          trackHistoryPush: () => trackRunHistoryPush(chat, turnRunId),
        });

        prepareNextStreamRound('Generating reply…');
        ephemeralPostToolInstruction = undefined;
        continue;
      }

      let fullText = turnResult.fullText;
      const streamMeta = turnResult.streamMeta;

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
        resetToolStartIndicator();
        awaitingProse = true;
        revealProse = (): void => {
          awaitingProse = false;
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
      const turnAttachments = validAttachments.filter((a) => a.kind !== 'error');
      if (
        askQuestionToolAvailable &&
        fullText.trim() &&
        !turnHasImageContext(chat, turnAttachments) &&
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

        const thinkingNormForPersist =
          thoughtController?.consumePersistedSegments() ?? [];
        const thinkingDurationForPersist = thinkingTracker?.finalizeRound() ?? 0;
        const { content: persistedContent } = resolveFinalAssistantContent(
          fullText,
          thinkingNormForPersist,
        );
        const proseRetryMeta = finalizeResponseMeta(
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

        if (isStreamDomVisible(chat.id)) {
          revealProse();
          setAssistantBubbleContent(bubble, persistedContent, {
            streaming: false,
            modeId: chat.modeId,
          });
          completeStreamAnnouncer(persistedContent);
        }

        const proseRetryAssistantMsg: AssistantMessage = {
          role: 'assistant',
          content: persistedContent,
          stats: proseRetryMeta.stats,
          usage: proseRetryMeta.usage,
        };
        if (thinkingNormForPersist.length > 0) {
          proseRetryAssistantMsg.thinking = thinkingNormForPersist;
          if (thinkingDurationForPersist > 0) {
            proseRetryAssistantMsg.thinkingDurationMs = thinkingDurationForPersist;
          }
        }
        chat.history.push(proseRetryAssistantMsg);
        trackRunHistoryPush(chat, turnRunId);
        syncTurnContextUsage(chat.id, '', thoughtController);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();

        if (isStreamDomVisible(chat.id)) {
          appendStats(lastWrap, proseRetryMeta.stats, proseRetryMeta.usage);
          if (thinkingNormForPersist.length > 0) {
            renderThoughtsToggle(lastWrap, thinkingNormForPersist, {
              durationMs:
                thinkingDurationForPersist > 0 ? thinkingDurationForPersist : undefined,
            });
          }
          const histIdx = chat.history.length - 1;
          const { attachMessageActions } = await import('../ui/message-actions');
          const { attachVoicePlayButton } = await import('../ui/voice-controls');
          attachMessageActions(lastWrap, {
            chatId: chat.id,
            historyIndex: histIdx,
            turnKind: 'assistant',
          });
          attachVoicePlayButton(lastWrap, persistedContent);
        }

        streamRow = appendStreamingAssistantRow(chat.id);
        ({ wrap, bubble, cursor, streamStatus } = streamRow);
        streamCtx.wrap = wrap;
        streamCtx.streamStatus = streamStatus;
        lastWrap = wrap;
        resetToolStartIndicator();
        awaitingProse = true;
        revealProse = (): void => {
          awaitingProse = false;
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

      const thinkingNorm = thoughtController?.consumePersistedSegments() ?? [];
      const thinkingDurationMs = thinkingTracker?.finalizeRound() ?? 0;
      const hasMeaningfulProse = assistantProseHasVisibleContent(
        fullText,
        thinkingNorm.length > 0,
      );
      const { content: finalContent, usedThinkingAsContent } =
        resolveFinalAssistantContent(fullText, thinkingNorm);
      const hasVisibleBubble = Boolean(fullText.trim()) || usedThinkingAsContent;

      if (!fullText.trim()) {
        logTurnDebug({
          event: 'finalize_empty_completion',
          turn,
          finalContentLen: finalContent.length,
          usedThinkingAsContent,
          persisted: hasMeaningfulProse,
        });
      }

      const roundMeta = finalizeResponseMeta(
        streamMeta,
        turnResult.t0,
        turnResult.tFirst ?? turnResult.tEnd,
        turnResult.tEnd,
      );
      const meta =
        turnStatsSegments.length > 0
          ? {
              ...aggregateTurnMetaSegments([
                ...turnStatsSegments,
                { stats: roundMeta.stats, usage: roundMeta.usage },
              ]),
              model_info: roundMeta.model_info,
            }
          : roundMeta;
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
      chat.lastStats = buildLastStatsSnapshot(displayMeta.stats, displayMeta.usage);
      chat.modelInfo = { ...modelInfo };
      // Persist the provider/model that served this turn (not the global default picker).
      chat.modelId = sendModelId;
      chat.providerId = sendProviderId;

      if (hasMeaningfulProse) {
        if (isStreamDomVisible(chat.id)) {
          if (hasVisibleBubble) {
            revealProse();
            setAssistantBubbleContent(bubble, finalContent, {
              streaming: false,
              modeId: chat.modeId,
            });
            if (thinkingNorm.length > 0) {
              renderThoughtsToggle(lastWrap, thinkingNorm, {
                durationMs: thinkingDurationMs > 0 ? thinkingDurationMs : undefined,
              });
            }
          } else if (thinkingNorm.length > 0) {
            anchorPersistedThoughtsOnRow(lastWrap, thinkingNorm, {
              durationMs: thinkingDurationMs > 0 ? thinkingDurationMs : undefined,
              streamStatus,
            });
          }
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
        if (streamTruncated) {
          assistantMsg.truncated = true;
        }
        chat.history.push(assistantMsg);
        trackRunHistoryPush(chat, turnRunId);
        syncTurnContextUsage(chat.id, '', thoughtController);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        if (isStreamDomVisible(chat.id)) {
          appendStats(lastWrap, meta.stats, meta.usage);
          const histIdx = chat.history.length - 1;
          const { attachMessageActions } = await import('../ui/message-actions');
          const { attachVoicePlayButton } = await import('../ui/voice-controls');
          attachMessageActions(lastWrap, {
            chatId: chat.id,
            historyIndex: histIdx,
            turnKind: 'assistant',
          });
          attachVoicePlayButton(lastWrap, finalContent);
          if (streamTruncated) {
            markMessageTruncated(lastWrap, chat);
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
      if (shouldUseBoardAggregateStats()) {
        refreshMetricsStripForChat(getActiveChat());
      }

      // Push-now during final prose: inject steer and run another model round in this turn.
      if (chat.pendingSteerMessage?.trim()) {
        prepareNextStreamRound('Steering…');
        continue;
      }

      synthesisRoundCount += 1;
      completedNormally = true;
      break;
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e && e.name === 'AbortError') {
      clearPendingSteer(chat);
      turnStopReason = takeChatStopReason(chat.id);
      turnRunStatus = 'stopped';
      cancelAllForParentTurn(parentTurnId);
      thinkingTracker?.abort();
      streamCtx.streamStatus.setThinkingElapsed(null);
      chat.currentGenerationId = undefined;
      scheduleSaveSessions();

      cancelAssistantBubbleRenderDebounce();
      finishStreamingBubbleRender(bubble, cursor);
      thoughtController?.abort();

      const text = livePartialText.trim();
      const thinkingNorm = thoughtController?.getSegmentsNormalized() ?? [];
      const wrapConnected = streamCtx.wrap.isConnected;

      if (text && wrapConnected) {
        streamCtx.wrap.classList.remove('msg--awaiting-prose');
        bubble.classList.remove('msg-bubble--awaiting');
        setAssistantBubbleContent(bubble, text, { streaming: false, modeId: chat.modeId });
        completeStreamAnnouncer(text);
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
        syncTurnContextUsage(chat.id, '', thoughtController);
        recordAssistantReplyOnChat(chat);
        recordChatMessage(chat);
        scheduleSaveSessions();
      }

      streamCtx.streamStatus.dispose();
      setStatus('ok', 'Stopped');
      return;
    }
    turnRunStatus = 'failed';
    markChatTurnError(chat);
    if (resumeGenerationId) {
      chat.currentGenerationId = undefined;
      scheduleSaveSessions();
    }
    const isBoardTaskChatFlag = isBoardTaskChat(chat);
    const failedRun = turnRunId ? findRunById(chat, turnRunId) : undefined;
    const failedForkIndex =
      failedRun?.forkHistoryIndex ?? resolveForkHistoryIndex(chat, pushUser);
    let rolledBack = false;
    let preservedTurnOutput = false;
    /*
     * A generation the server forgot across a restart produced nothing here, so
     * there is no partial tail to undo — slicing history can only destroy rows the
     * turn never wrote. Leave the transcript alone and let the user retry.
     */
    const generationLost = e.message === GENERATION_LOST_ON_RESTART_MESSAGE;
    if (generationLost) {
      // Transcript stays as-is; the notice attaches as its own row below.
      preservedTurnOutput = true;
      // Still drop an orphan tool tail — replaying that would poison the retry.
      if (repairSessionHistoryTail(chat)) {
        scheduleSaveSessions();
        renderSidebar();
      }
      if (isStreamDomVisible(chat.id)) {
        removeOrphanStreamingRow(streamCtx.wrap, streamCtx.streamStatus);
        renderChatFromHistory(chat);
      }
    } else if (isBoardTaskChatFlag) {
      const repaired = repairSessionHistoryTail(chat);
      if (repaired) {
        recordChatMessage(chat);
        scheduleSaveSessions();
        renderSidebar();
        if (isStreamDomVisible(chat.id)) {
          renderChatFromHistory(chat);
        }
      }
    } else if (turnProducedOutput(chat.history, failedForkIndex)) {
      preservedTurnOutput = true;
      repairSessionHistoryTail(chat);
      recordChatMessage(chat);
      scheduleSaveSessions();
      renderSidebar();
      if (isStreamDomVisible(chat.id)) {
        removeOrphanStreamingRow(streamCtx.wrap, streamCtx.streamStatus);
        renderChatFromHistory(chat);
      }
    } else {
      rolledBack = rollbackFailedTurnHistory(chat, failedForkIndex);
      if (rolledBack) {
        recordChatMessage(chat);
        scheduleSaveSessions();
        renderSidebar();
        if (isStreamDomVisible(chat.id)) {
          renderChatFromHistory(chat);
        }
      }
    }
    cancelAssistantBubbleRenderDebounce();
    const lost =
      e.message === GENERATION_LOST_ON_RESTART_MESSAGE
        ? GENERATION_LOST_ON_RESTART_MESSAGE
        : `Could not complete this reply: ${formatGenerationErrorMessage(e.message ?? 'Unknown error')}`;
    turnErrorMessage = lost;
    // Board stream-end subscribers run before the final `finalizeRun` pass.
    // Publish the failure signal now so recovery can classify provider errors.
    if (failedRun) {
      failedRun.status = 'failed';
      failedRun.errorMessage = lost;
    }
    if (superPlanStage && rolledBack) {
      appendSuperPlanStageFailureNotice(chat, superPlanStage, lost);
      recordChatMessage(chat);
      scheduleSaveSessions();
      renderSidebar();
      if (isStreamDomVisible(chat.id)) {
        renderChatFromHistory(chat);
      }
    }
    void import('../boot/report-background-error.js').then((mod) => {
      mod.reportBackgroundError('chat-turn-failed', err);
    });
    if (isStreamDomVisible(chat.id)) {
      if (!rolledBack) {
        if (preservedTurnOutput) {
          const { bubble: errorBubble } = appendBubble('assistant', '', {
            historyIndex: chat.history.length,
            turnKind: 'assistant',
            chatId: chat.id,
            modeId: chat.modeId,
          });
          setAssistantErrorBubbleWithRecovery(errorBubble, lost, {
            chatId: chat.id,
            forkHistoryIndex: failedForkIndex,
          });
        } else {
          finishStreamingBubbleRender(bubble, cursor);
          revealProse();
          setAssistantErrorBubbleWithRecovery(bubble, lost, {
            chatId: chat.id,
            forkHistoryIndex: failedForkIndex,
          });
        }
      }
      const msg = e.message ?? '';
      const statusMsg = msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
      const attachHint =
        sentAttachments.length > 0 ? ' Attachments kept for retry.' : '';
      setStatus('err', (rolledBack ? lost : statusMsg) + attachHint);
    } else {
      const statusMsg = lost.length > 80 ? `${lost.slice(0, 77)}…` : lost;
      setStatus('err', statusMsg);
    }
  } finally {
    turnTeardownRan = true;
    streamingStatsPublisher.reset();
    setContextInFlightOverlay(null);
    scheduleContextUsageRefresh();
    registerStreamDomRemount(chat.id, null);
    if (uiDesignerCtx.active) {
      chat.workAgentId = savedWorkAgentId;
    }
    setSubAgentExecutorContext(null);
    setBoardExecutorContext(null);
    setBugBoardExecutorContext(null);
    if (normalizeModeId(chat.modeId) === 'orchestrate') {
      const board = getBoardGroupForChat(chat)?.orchestrateBoard;
      if (board?.activeParentTurnId) {
        delete board.activeParentTurnId;
        touchChat(chat);
        scheduleSaveSessions();
      }
    }
    thoughtController?.abort();
    thinkingTracker?.abort();
    if (!completedNormally) {
      restorePendingAttachments(sentAttachments);
    }
    if (completedNormally) {
      if (deferTitleUntilTurnEnd || shouldScheduleTitle) {
        const seed = titleSeed?.trim() || userText?.trim() || rawText?.trim();
        if (seed) {
          scheduleChatTitleGeneration(chat.id, seed, {
            modelId: sendModelId?.trim() || undefined,
            providerId: sendProviderId?.trim() || undefined,
          });
        }
      }
      if (normalizeModeId(chat.modeId) !== 'debug') {
        const lastAssistant = [...chat.history]
          .reverse()
          .find((m) => m.role === 'assistant');
        const assistantText =
          lastAssistant && typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : '';
        schedulePostTurnSynthesis({
          chatId: chat.id,
          messages: buildSynthesisMessages(chat),
          roundCount: synthesisRoundCount,
          toolCount: synthesisToolCount,
          sourceExcerpt: buildSynthesisExcerpt(chat),
          assistantText,
          boardChat: isBoardOwnedChat(chat) || isBoardTaskChat(chat),
          ...(chat.kind === 'expert' && chat.expertId?.trim()
            ? { expertId: chat.expertId.trim() }
            : {}),
        });
      }
    }
    clearMainTurnActivity(chat.id);
    if (turnRunId) {
      const run = findRunById(chat, turnRunId);
      const start = run?.outputHistoryStart;
      const end = run?.outputHistoryEnd;
      const persistOutput =
        turnRunStatus !== 'failed' || Boolean(chat.boardTaskId?.trim());
      const outputMessages =
        persistOutput &&
        start !== undefined &&
        end !== undefined &&
        end >= start
          ? chat.history.slice(start, end + 1).map((m) => ({ ...m }))
          : undefined;
      finalizeRun(chat, turnRunId, {
        status: turnRunStatus,
        outputHistoryStart: persistOutput ? start : undefined,
        outputHistoryEnd: persistOutput ? end : undefined,
        outputMessages,
        stopReason: turnRunStatus === 'stopped' ? (turnStopReason ?? 'user') : undefined,
        endReason: turnEndReason,
        errorMessage: turnErrorMessage,
      });
      // MIN-409: post-turn snapshot after history suffix is known (best-effort).
      await capturePostTurnSnapshot(chat, turnRunId);
      scheduleSaveSessions();
      if (isStreamDomVisible(chat.id) && run) {
        refreshBranchPickerAtFork(chat, run.forkHistoryIndex);
      }
    }
    if (ownsGlobalStreaming) {
      notifyChatStreamEnded(chat.id);
      setStreaming(false, chat.id);
      flushPendingMode(chat);
      syncOrchestrateInitSplitChrome(chat);
      setSidebarStreamPhase(null, chat.id);
      syncChatItemDotsInDom();
      if (isStreamDomVisible(chat.id)) {
      refreshModeSelectorDisabled();
      refreshComposerReasoningEffortDisabled();
      refreshOrchestratePlanSelectorDisabled();
        refreshBoardOnboardingIfMounted();
        syncViewModeToggleFromActiveChat();
        refreshViewModeToggleDisabled();
        syncComposerFromStreamingState();
      } else {
        syncComposerFromStreamingState();
      }
      const runGoalEvalAfterTurn = shouldEvaluateGoalAfterTurn(chat, goalDriven);
      if (
        completedNormally &&
        !runGoalEvalAfterTurn &&
        !chat.pendingSteerMessage?.trim() &&
        !isSuperPlanPipelineOwningChatTurns(chat)
      ) {
        void flushPendingMessageQueue(chat).then(() => {
          syncComposerMessageQueue();
        });
      }
      if (completedNormally && runGoalEvalAfterTurn) {
        void maybeContinueGoalAfterTurn(chat);
      }
      if (completedNormally) {
        // Self-paced /loop backoff after the fired turn settles
        maybeRescheduleLoopsAfterTurn(chat);
      }
      if (completedNormally && isPartyModePinned(chat.pinnedSkill) && isStreamDomVisible(chat.id)) {
        burstPartyConfetti();
      }
      if (turnRunId) {
        const endedRunId = turnRunId;
        void import('../notifications/chat-turn.js').then((mod) => {
          mod.notifyChatTurnEnded(chat.id, endedRunId);
        });
      }
    }
    if (getChatAbort(chat.id)?.signal === chatSignal) {
      setChatAbort(chat.id, null);
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
    if (turnMountPinned) {
      setTurnChatMount(null);
    }
    endChatTurnSetup(chat.id);
    if (!turnTeardownRan) {
      /*
       * Setup threw before the streaming try/finally, so the activity row, abort
       * handle and streaming flag registered above were never released. Left
       * behind they show the chat as running forever in the agent activity panel,
       * and Stop cannot help — it aborts a controller with no listener.
       * The generation id is kept: the backend turn may still be resumable.
       */
      flushStoppedChatPresentation([chat.id], { keepGenerationId: true });
    }
  }
}

export interface ResumeParentChatOptions {
  suppressUserEcho?: boolean;
  goalDriven?: boolean;
}

/**
 * Programmatic parent turn (e.g. sub-agent completion push). Uses the chat's stored model when
 * it is not the active sidebar chat. Skips slash/skill resolution — prefer
 * {@link sendProgrammaticChatText} when the text may include `/skills`.
 */
export async function resumeParentChatWithMessage(
  chat: Chat,
  message: string,
  options: ResumeParentChatOptions = {},
): Promise<void> {
  if (isChatStreaming(chat.id)) return;
  if (isChatTurnSetupPending(chat.id)) return;
  if (!chat.modelId?.trim()) return;

  await runChatTurn({
    chat,
    pushUser: true,
    suppressUserEcho: options.suppressUserEcho ?? false,
    rawText: message,
    userText: message,
    skillId: null,
    displayText: message,
    historyContent: message,
    validAttachments: [],
    ownsGlobalStreaming: chat.id === getActiveChat().id,
    goalDriven: options.goalDriven ?? false,
  });
}

/** Options for {@link sendProgrammaticChatText}. */
export interface SendProgrammaticChatTextOptions {
  goalDriven?: boolean;
  suppressUserEcho?: boolean;
  ephemeralContext?: string;
  validAttachments?: Attachment[];
  composerSurface?: Partial<ComposerSurface>;
  /**
   * When true (default), always run {@link parseSlashCommand}.
   * Composer path passes false unless the skill picker confirmed a skill.
   */
  parseSlash?: boolean;
  /** Pre-adjusted slash input (orchestrate plan injection); defaults to `text`. */
  slashInput?: string;
  titleSeed?: string;
  deferTitleUntilTurnEnd?: boolean;
  ownsGlobalStreaming?: boolean;
  /** Report status errors (defaults to setStatus). */
  reportStatus?: (level: 'ok' | 'err', message: string) => void;
}

/**
 * Slash/skill-resolving programmatic send used by /loop fires and the composer path.
 * Resolves skills the same way as a user send so looped prompts can be any `/skill`.
 */
export async function sendProgrammaticChatText(
  chat: Chat,
  text: string,
  options: SendProgrammaticChatTextOptions = {},
): Promise<void> {
  if (isChatStreaming(chat.id)) return;
  if (isChatTurnSetupPending(chat.id)) return;

  const report = options.reportStatus ?? setStatus;
  const rawText = text;
  const slashInput = options.slashInput ?? rawText;
  const validAttachments = options.validAttachments ?? [];
  const parseSlash = options.parseSlash !== false;

  const { skillId: slashSkillId, userText: slashUserText } = parseSlash
    ? parseSlashCommand(slashInput)
    : { skillId: null, userText: slashInput.trim() };

  const turnSkill = resolveTurnSkill({
    slashSkillId,
    userText: slashUserText,
    pinned: chat.pinnedSkill,
    isSkillEnabled,
  });
  chat.pinnedSkill = turnSkill.nextPinned;
  const skillId = turnSkill.skillId;
  const userText = normalizeCavemanUserText(skillId, slashSkillId, slashUserText);
  const hasUserText = Boolean(userText.trim());

  if (!rawText.trim() && validAttachments.length === 0 && !slashInput.trim()) return;
  if (!skillId && !hasUserText && validAttachments.length === 0) return;

  if (chat.modelId?.trim()) {
    syncPerChatModelBindingFromCatalog(chat);
    touchChat(chat);
  } else {
    const binding = resolveEffectiveChatModelBinding(chat);
    if (binding.selectValue) {
      applyModelSelectValueToChat(chat, binding.selectValue);
      touchChat(chat);
    } else if (binding.modelId) {
      chat.modelId = binding.modelId;
      if (binding.providerId) {
        chat.providerId = binding.providerId;
      }
      touchChat(chat);
    }
  }
  if (!chat.modelId?.trim()) {
    report('err', 'Select a model first');
    return;
  }

  await detectLocalServer();

  let skillBody: string | null = null;
  if (skillId) {
    const skill = await resolveActiveSkill(skillId);
    if (!skill?.body?.trim()) {
      report('err', `Unknown skill: ${skillId}`);
      return;
    }
    skillBody = skill.body;
    if (shouldComposeImpeccableBody(skillId, userText)) {
      skillBody = await composeImpeccableSkillBody(skillBody, userText);
    }
    if (skillId === CAVEMAN_SKILL_ID) {
      skillBody = augmentCavemanSkillBody(skillBody, {
        userText,
        pinnedIntensity: chat.pinnedSkill?.intensity,
      });
    }
    if (skillId === PARTYMODE_SKILL_ID) {
      skillBody = augmentPartyModeSkillBody(skillBody);
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

  if (!hasUserText && validAttachments.length === 0 && !skillBody?.trim()) {
    report('err', 'Add a message or attachment');
    if (uiDesignerCtx.active) {
      chat.workAgentId = savedWorkAgentId;
    }
    return;
  }

  const displayText = skillId
    ? formatHistoryWithSkillTag(userText, skillId)
    : userText || rawText;
  const historyContent = buildHistoryUserContent(displayText, validAttachments);
  const titleSeed =
    options.titleSeed ??
    (userText || rawText || validAttachments[0]?.name || 'Attachment');
  const deferTitleUntilTurnEnd =
    options.deferTitleUntilTurnEnd ?? isFirstUserMessagePending(chat);
  const firstUserSend = deferTitleUntilTurnEnd;

  syncComposerPinnedSkillFromActiveChat();
  scheduleSaveSessions();
  syncGoalActiveHint();
  syncLoopActiveHint();
  syncTodoPanel();

  await runChatTurn({
    chat,
    pushUser: true,
    suppressUserEcho: options.suppressUserEcho ?? false,
    rawText,
    userText,
    skillId,
    displayText,
    historyContent,
    validAttachments,
    titleSeed,
    deferTitleUntilTurnEnd,
    firstUserSend,
    skillBody,
    composerSurface: options.composerSurface,
    goalDriven: options.goalDriven ?? false,
    ephemeralContext: options.ephemeralContext,
    ownsGlobalStreaming:
      options.ownsGlobalStreaming ?? chat.id === getActiveChat().id,
  });
}

/** Send the composer text with tool calling (SSE loop until final answer or user cancel). */
export interface ComposerSendOptions extends Partial<ComposerSurface> {
  /** Surface-owned context injected for this turn without adding it to chat history. */
  ephemeralContext?: string;
}

export async function sendMessageWithTools(
  composer?: ComposerSendOptions,
): Promise<void> {
  const { inputEl: input } = resolveComposerSurface(composer);
  if (!input) {
    setStatus('err', 'Composer is not available');
    return;
  }
  const rawTextEarly = input.value.trim();
  if (isActiveChatStreaming()) {
    if (!rawTextEarly) return;
    const pendingSteer = getPendingAttachments();
    const pendingOk = pendingSteer.filter((a) => a.kind !== 'error');
    if (pendingOk.length > 0) {
      setStatus('err', 'Follow-ups are text only — wait for this turn to finish for attachments');
      return;
    }
    const chat = getActiveChat();
    if (enqueueComposerMessage(chat, rawTextEarly)) {
      clearComposerAfterSend(chat, input);
      setStatus('ok', 'Follow-up queued');
      refreshComposerStreamingAffordance();
      syncComposerMessageQueue();
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
    const editChat =
      sessionState?.chats.find((c) => c.id === pendingEdit.chatId) ?? getActiveChat();
    clearComposerAfterSend(editChat, input);
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

  // /loop before /goal so both stateful commands settle without skill resolution
  const loopDispatch = handleLoopCommand(chat, rawText, setStatus);
  if (loopDispatch === 'handled') {
    clearComposerAfterSend(chat, input);
    return;
  }

  const goalDispatch = handleGoalCommand(chat, rawText, setStatus);
  if (goalDispatch === 'handled') {
    clearComposerAfterSend(chat, input);
    return;
  }

  const sendProviderId =
    chat.providerId?.trim() ||
    (document.getElementById('providerSelect') as HTMLSelectElement | null)?.value?.trim() ||
    '';
  const sendModelId =
    chat.modelId?.trim() ||
    (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value?.trim() ||
    '';

  const compressDispatch = await handleCompressCommand(
    chat,
    rawText,
    sendProviderId,
    sendModelId,
  );
  if (compressDispatch === 'handled') {
    clearComposerAfterSend(chat, input);
    return;
  }

  let goalDriven = isGoalLoopActive(chat);
  let effectiveRawText = rawText;
  if (goalDispatch === 'set') {
    goalDriven = true;
    effectiveRawText = getActiveGoal(chat)?.conditionText ?? rawText;
    clearComposerAfterSend(chat, input);
  }

  const orchestratePlanPath = resolveEffectiveOrchestratePlanPathWithSync(
    chat,
    getBoardGroupForChat(chat),
    { sync: true },
  );

  if (
    orchestrateRequiresPlanBlock(
      chat.modeId,
      orchestratePlanPath,
      effectiveRawText,
      pendingWithoutErrors.length,
    ) === 'block'
  ) {
    setStatus('err', 'Select a plan to orchestrate');
    return;
  }

  const slashInput = resolveOrchestrateSlashInput(
    chat.modeId,
    orchestratePlanPath,
    effectiveRawText,
  );
  const pickerSkillId = goalDriven ? null : getPickerAppliedSkillId(input);

  // Composer sampler UI checks (programmatic path uses runChatTurn's sampler reader)
  const tempEl = document.getElementById('temperature') as HTMLInputElement | null;
  const maxTokEl = document.getElementById('maxTokens') as HTMLInputElement | null;
  if (tempEl && maxTokEl) {
    const temp = parseFloat(tempEl.value);
    const maxTok = parseInt(maxTokEl.value, 10);
    if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
      setStatus('err', 'Temperature must be 0 to 2');
      return;
    }
    if (!Number.isFinite(maxTok) || maxTok < 1) {
      setStatus('err', 'Max tokens must be at least 1');
      return;
    }
  }

  // Peek skill resolution for Super Plan routing / empty checks before attachments resolve
  const peekSlash = pickerSkillId
    ? parseSlashCommand(slashInput)
    : { skillId: null as string | null, userText: slashInput.trim() };
  const peekTurn = resolveTurnSkill({
    slashSkillId: peekSlash.skillId,
    userText: peekSlash.userText,
    pinned: chat.pinnedSkill,
    isSkillEnabled,
  });
  const peekSkillId = peekTurn.skillId;
  const peekUserText = normalizeCavemanUserText(
    peekSkillId,
    peekSlash.skillId,
    peekSlash.userText,
  );
  const hasUserText = Boolean(peekUserText.trim());
  if (!effectiveRawText && pendingWithoutErrors.length === 0 && !slashInput.trim()) return;
  if (!peekSkillId && !hasUserText && pendingWithoutErrors.length === 0) return;

  const resolvedAttachments = await resolveWorkspaceReferences(pending);
  const validAttachments = resolvedAttachments.filter((a) => a.kind !== 'error');
  if (validAttachments.length === 0 && !hasUserText && pendingWithoutErrors.length > 0) {
    replacePendingAttachments(resolvedAttachments);
    setStatus('err', 'Could not read attached workspace file(s)');
    return;
  }
  replacePendingAttachments(resolvedAttachments);

  // Say it up front when the pixels are not going to make it. The model is told
  // too (USER_IMAGE_NO_VISION_HINT), but the user should not have to read the
  // reply to find out their screenshot was dropped.
  if (attachmentsHaveImages(validAttachments) && !canSendImagesToModel(sendModelId)) {
    setStatus('err', 'This model cannot read images — sending the text only');
  }

  const { shouldRouteComposerSendToSuperPlan, startPlanningFromComposer } = await import(
    '../ui/orchestrate-plan-screen'
  );
  if (normalizeModeId(chat.modeId) === 'super-plan' && hasUserText && !peekSkillId) {
    if (validAttachments.length > 0) {
      setStatus('err', 'Super Plan starts from text only — remove attachments first');
      return;
    }
  }
  if (
    shouldRouteComposerSendToSuperPlan(chat, {
      userText: peekUserText,
      skillId: peekSkillId,
      attachmentCount: validAttachments.length,
    })
  ) {
    clearComposerAfterSend(chat, input);
    await startPlanningFromComposer(peekUserText || effectiveRawText);
    return;
  }

  if (!goalDispatch) {
    clearComposerAfterSend(chat, input);
  }

  await sendProgrammaticChatText(chat, effectiveRawText, {
    goalDriven,
    validAttachments,
    composerSurface: composer,
    // Preserve prior composer behavior: only parse /skills when the picker confirmed one
    parseSlash: Boolean(pickerSkillId),
    slashInput,
    ephemeralContext: composer?.ephemeralContext,
    ownsGlobalStreaming: true,
  });
}
