/**
 * P6-D (MIN-726) — product chat send path. One turn loop: `runTurn()`.
 *
 * Callers (composer, Super Plan, resume, attachments) compose messages and
 * overlays around `runTurn`. Import from `server/runner/index.js` (isomorphic).
 * Never import `node.js` or `tool-dispatch.js`.
 *
 * Sub-agents spawn *within* a turn via POST `/api/agents` (P8-F store).
 * This file is not a second SSE/tool loop.
 */

import { runTurn } from '../../server/runner/index.js';
import type {
  AskCapability,
  RunTurnOptions,
  TurnResult,
} from '../../server/runner/run-turn';
import {
  ASK_QUESTION_TOOL_NAME,
  DEFAULT_ASK_TIMEOUT_MS,
} from '../../server/runner/run-turn';
import type { TranscriptMessage, TranscriptStore } from '../../server/runner/transcript-store';
import { createSessionTranscriptStore } from '../agents/session-transcript-store';
import { createChatTranscriptStore, type ChatTranscriptStore } from './chat-transcript-store';
import {
  isAbortError,
  isAbortedTurnResult,
  isFailedTurnResult,
  isGenerationLostMessage,
  settleFailedTurn,
  settleStoppedTurn,
  type InterruptedTurnChrome,
} from './settle-interrupted-turn';
import { createRendererRunnerDeps } from '../agents/renderer-runner-deps';
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
import { getChatAbort, setChatAbort, setStreaming, modelCache } from '../app-state';
import { getChatMetaSync } from '../config/chat-meta';
import { mergeGlobalSamplerWithLibraryModel } from '../config/library-inference-meta';
import { readGlobalSamplerForSend } from '../config/sampler-meta';
import { resolveSamplerPreset } from '../agents/resolve-sampler';
import { resolveThinkingMode } from '../agents/resolve-thinking';
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
import { fetchReplayPriorReasoningEnabled } from './context/reasoning-replay-config';
import { resolveContextLimit } from './context-usage';
import {
  appendInjectionNoticesForTurn,
} from './context/injection-notice';
import { hiddenTranscriptUserMessage } from './hidden-transcript-user-messages';
import {
  superPlanPipelineUserMessage,
} from './super-plan/hidden-user-messages';
import type { SuperPlanStageId } from './super-plan/types';
import { normalizeModeId } from './modes/types';
import { resolveOutboundSystemMessages } from './prompts/compose-context';
import {
  beginChatTurnSetup,
  endChatTurnSetup,
  isChatTurnSetupPending,
} from './chat-turn-guard';
import {
  isChatStreaming,
  isStreamDomVisible,
  notifyChatStreamActivity,
  notifyChatStreamEnded,
} from './streaming-state';
import {
  createChatTurnEventPainter,
  finalizeAndAnchorThinkingRound,
  type ChatTurnEventPainter,
  type ChatTurnPaintHost,
} from './run-turn-chat-paint';
import { createStreamingStatsPublisher } from './streaming-stats';
import {
  applyStreamMetaEvent,
  runtimeStatusFromStreamMetaRuntime,
  streamMetaFromRoundEnd,
} from './turn-stream-meta';
import { aggregateTurnMetaSegments } from './plans/stats-math';
import {
  finalizeResponseMeta,
  type StreamMetaAccumulator,
} from '../api/chat';
import { resolveModelInfo } from '../api/models';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { consumePendingSteer, clearPendingSteer } from './steer-message';
import { flushPendingMessageQueue } from './message-queue';
import { syncComposerMessageQueue } from '../ui/composer-message-queue';
import {
  setContextInFlightOverlay,
  syncTurnContextUsage,
} from './context-in-flight';
import { scheduleContextUsageRefresh } from '../ui/context-usage-ring';
import {
  isFirstUserMessagePending,
  scheduleChatTitleGeneration,
} from './titles/schedule';
import { clearPostToolTailBeforeSend } from './history';
import { buildTurnSnapshot, resolveForkHistoryIndex } from './turn-snapshot';
import {
  capturePostTurnSnapshot,
  capturePreTurnSnapshot,
} from './turn-snapshots';
import {
  clearMainTurnActivity,
  emitMainTurnActivity,
  patchMainTurnActivity,
} from './main-turn-activity';
import type { ForkOverrides } from './fork-from-run';
import {
  overlayMultimodalHistoryForRunTurn,
  chatTurnNeedsMultimodalOverlay,
  persistableUserImages,
} from './build-api-messages';
import {
  ensureChatHistoryLoaded,
  getActiveChat,
  recordChatMessage,
  requireHistory,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import {
  createRun,
  finalizeRun,
  findRunById,
} from '../state/runs-store';
import { isBoardOwnedChat, isBoardTaskChat } from '../state/chat-groups';
import type {
  Chat,
  ChatStopReason,
  Message,
  ModelInfo,
  Stats,
  TurnRunId,
  TurnRunStatus,
  TurnSnapshot,
  Usage,
} from '../types';
import type { StreamingStatusHandle } from '../ui/stream-status';
import type { Attachment } from '../attachments/types';
import { linkSentAttachmentsToTurn } from '../design/annotation-store';
import {
  clearAttachments,
  getPendingAttachments,
  restorePendingAttachments,
} from '../attachments/store';
import { getActiveProvider } from '../providers/store';
import { isLocalProvider } from '../providers/provider-host';
import { canSendImagesToModel } from '../providers/vision-model.ts';
import { acquireTickedMotion } from '../ui/motion-ticker';
import { executeTool, getEnabledToolDefinitionsForChat } from '../tools/client';
import { getToolById } from '../tools/definitions';
import { enqueueAskQuestion } from '../tools/ask-question-queue';
import {
  stringifyAskQuestionResult,
  validateAskQuestionArgs,
} from '../tools/ask-question-types';
import { setSubAgentExecutorContext } from '../tools/sub-agent-executor';
import { setBugBoardExecutorContext } from '../tools/bug-board-tools';
import {
  isParallelSafeTool,
  parallelToolsActivityLabel,
} from '../tools/parallel-tool-policy';
import { assertUiDesignerToolAllowed } from '../agents/ui-designer/tools';
import { resolveChatToolWorkspaceRoot } from '../state/chat-worktree';
import {
  recordChatCompletionUsage,
  recordMainChatTurnUsage,
} from '../usage/record-chat-usage';
import { hasMeasurableUsage } from '../usage/pricing';
import { schedulePostTurnSynthesis } from '../synthesis/client';
import {
  buildSynthesisExcerpt,
  buildSynthesisMessages,
} from '../synthesis/post-turn';
import {
  composeImpeccableSkillBody,
  shouldComposeImpeccableBody,
  augmentCavemanSkillBody,
  augmentPartyModeSkillBody,
  CAVEMAN_SKILL_ID,
  PARTYMODE_SKILL_ID,
  GIT_SETUP_SKILL_ID,
  prepareGitSetupTurn,
  isPartyModePinned,
  resolveActiveSkill,
} from '../skills';
import { burstPartyConfetti } from '../ui/party-confetti';
import {
  appendBubble,
  appendInjectionNoticesDom,
  appendStats,
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
} from '../ui/messages';
import { ThinkingDurationTracker } from '../ui/thinking-duration';
import { markMessageTruncated } from '../ui/truncated-affordance';
import {
  cancelAssistantBubbleRenderDebounce,
  finishStreamingBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import {
  ThoughtBubbleController,
  type ThoughtPhaseCallbacks,
} from '../ui/thought-bubbles';
import { getActiveChatMountElement, setTurnChatMount } from '../ui/chat-mount';
import {
  resolveComposerSurface,
  clearComposerInput,
  type ComposerSurface,
} from '../ui/composer-surface';
import { clearComposerDraftOnChat } from '../ui/composer-draft';
import {
  recordAssistantReplyOnChat,
  setSidebarStreamPhase,
  syncChatItemDotsInDom,
} from '../ui/chat-item-dot';
import { renderSidebar } from '../ui/sidebar';
import { setStatus } from '../ui/status';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import { completeStreamAnnouncer } from '../ui/a11y/stream-announcer';
import { refreshBranchPickerAtFork } from '../ui/branch-picker';
import { registerStreamDomRemount } from '../tools/stream-chat-dom';
import {
  applyModelSelectValueToChat,
} from '../lib/model-select-key';
import {
  resolveEffectiveChatModelBinding,
  syncPerChatModelBindingFromCatalog,
} from '../ui/default-model';
import { postChatCompletions } from '../providers/fetch-chat';
import type { PostChatCompletionsOptions } from '../../server/runner/adapters';

/** Browser-native tools kept as a catalog floor for tests. */
export const RUN_TURN_CHAT_SPIKE_TOOL_IDS = ['get_datetime', 'calculate'] as const;

/** Options for {@link runChatTurn} (composer send or history resend). */
export interface RunChatTurnOptions {
  chat: Chat;
  /** When false, the last user row in history is reused (regenerate / remake). */
  pushUser: boolean;
  rawText: string;
  userText: string;
  skillId: string | null;
  displayText?: string;
  historyContent: string;
  validAttachments: Attachment[];
  titleSeed?: string;
  shouldScheduleTitle?: boolean;
  /** Run title job after the first turn completes (avoids competing with main chat for TTFT). */
  deferTitleUntilTurnEnd?: boolean;
  /** First user message in chat (capture before history.push). */
  firstUserSend?: boolean;
  /** Pre-resolved skill body when skillId is set (composer / Super Plan path). */
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

export interface ResumeParentChatOptions {
  suppressUserEcho?: boolean;
  goalDriven?: boolean;
}

/** Test hook so stream-end order can be recorded without mocking ESM. */
let setStreamingFn: typeof setStreaming = setStreaming;
let notifyChatStreamEndedFn: typeof notifyChatStreamEnded = notifyChatStreamEnded;

function endRunTurnChatStreaming(chatId: string): void {
  // PRD §1.3: setStreaming(false) BEFORE notifyChatStreamEnded on this path.
  setStreamingFn(false, chatId);
  notifyChatStreamEndedFn(chatId);
}

let endStreamingImpl: (chatId: string) => void = endRunTurnChatStreaming;

/**
 * Replace stream-end helpers in tests. Pass `null` to restore production
 * `setStreaming` + `notifyChatStreamEnded`.
 */
export function setRunTurnChatEndStreamingForTests(
  fns: {
    setStreaming?: typeof setStreaming;
    notifyChatStreamEnded?: typeof notifyChatStreamEnded;
  } | null,
): void {
  setStreamingFn = fns?.setStreaming ?? setStreaming;
  notifyChatStreamEndedFn = fns?.notifyChatStreamEnded ?? notifyChatStreamEnded;
  endStreamingImpl = endRunTurnChatStreaming;
}

/**
 * Watchdog for the injected ask. Honors Settings → Watchdog idle when
 * it is a positive number; otherwise the runner default (60 min). Never `0`.
 */
export function resolveSpikeAskTimeoutMs(): number {
  const idle = getChatMetaSync().generationIdleTimeoutMs;
  return idle > 0 ? idle : DEFAULT_ASK_TIMEOUT_MS;
}

/**
 * Capability injected into `runTurn`. Backed by the existing question
 * card queue — `ask_question` is not added to `spikeChatToolDefinitions()`.
 */
export function createChatAskCapability(input: {
  chatId: string;
  enqueue?: typeof enqueueAskQuestion;
}): AskCapability {
  const enqueue = input.enqueue ?? enqueueAskQuestion;
  return {
    async ask(question) {
      const parsed = validateAskQuestionArgs(asToolArgs(question));
      if (parsed.ok === false) {
        return stringifyAskQuestionResult({ status: 'error', message: parsed.error });
      }
      return enqueue(parsed.args, {}, input.chatId);
    },
  };
}

/**
 * Round-boundary hook for in-turn steer (P10-I / MIN-774).
 * Same injection shape as {@link createChatAskCapability}: the runner does
 * not know what a chat is. Boards omit `onRoundBoundary`.
 */
export function createChatRoundBoundary(
  chat: Chat,
): () => TranscriptMessage[] | null {
  return () => {
    const result = consumePendingSteer(chat);
    // Queue strip is last-write-wins with pendingSteer; refresh after consume.
    syncComposerMessageQueue();
    if (!result.consumed || typeof result.content !== 'string' || !result.content) {
      return null;
    }
    // Product `steer: true` is already on chat.history. The runner strips
    // unknown fields before the next completion.
    return [{ role: 'user', content: result.content }];
  };
}

/** Injected in tests so we can assert `runTurn` was actually called. */
type RunTurnFn = (options: RunTurnOptions) => Promise<TurnResult>;
let runTurnImpl: RunTurnFn = runTurn;

/** Replace `runTurn` in tests. Pass the real function (or omit) to restore. */
export function setRunTurnForTests(fn: RunTurnFn | null): void {
  runTurnImpl = fn ?? runTurn;
}

export function resetRunTurnForTests(): void {
  runTurnImpl = runTurn;
}

/**
 * Isolated buffer used by the P6-A spike. P6-C persist suffixes against the
 * session store instead; this helper remains for tests that assert the wrap.
 */
export function createChatTurnTranscriptStore(chatId: string): {
  store: TranscriptStore;
  getIsolatedMessages: () => TranscriptMessage[];
} {
  const session = createSessionTranscriptStore();
  const isolated: TranscriptMessage[] = [];
  return {
    getIsolatedMessages: () => isolated.slice(),
    store: {
      load(id) {
        const meta = session.load(id)?.meta ?? {};
        return { messages: isolated.slice(), meta };
      },
      append(_id, message) {
        isolated.push(message);
      },
      setMeta(id, meta) {
        session.setMeta(id, meta);
      },
    },
  };
}

/** OpenAI function tools for the two spike ids, if they exist in the catalog. */
export function spikeChatToolDefinitions(): RunTurnOptions['tools'] {
  const tools: RunTurnOptions['tools'] = [];
  for (const id of RUN_TURN_CHAT_SPIKE_TOOL_IDS) {
    const def = getToolById(id)?.definition;
    if (!def) continue;
    tools.push({
      type: 'function',
      function: {
        name: def.function.name,
        description: def.function.description,
        parameters: def.function.parameters as Record<string, unknown>,
      },
    });
  }
  return tools;
}

/**
 * Mode catalog for this chat. Plan-mode write guard stays in `executeTool`.
 * `ask_question` may be in the list; routing still goes through
 * {@link createChatAskCapability}. UI Designer remaps the allow-list here.
 */
export function chatToolDefinitionsForTurn(
  chat: Chat,
  skillId?: string | null,
): RunTurnOptions['tools'] {
  let defs = getEnabledToolDefinitionsForChat(chat, { skillId });
  const agent = resolveActiveWorkAgent(chat);
  if (agent?.allowedTools?.length) {
    const allow = new Set(agent.allowedTools);
    defs = defs.filter((t) => allow.has(t.function.name));
  }
  const uiDesignerCtx = prepareUiDesignerTurn(chat, {
    skillId: skillId ?? null,
    userText: '',
    workAgentId: chat.workAgentId,
  });
  defs = applyUiDesignerToolFilter(defs, uiDesignerCtx);
  return defs.map((def) => ({
    type: 'function' as const,
    function: {
      name: def.function.name,
      description: def.function.description,
      parameters: def.function.parameters as Record<string, unknown>,
    },
  }));
}

/**
 * Compose system prompt for `runTurn`. Exclusive skill bodies (impeccable /
 * caveman / partymode) and UI Designer remap live here — not a second loop.
 * User rules concatenate into one systemPrompt (no second system message).
 */
export async function composeRunTurnChatSystemPrompt(input: {
  chat: Chat;
  rawText: string;
  userText: string;
  skillId?: string | null;
  skillBody?: string | null;
  composedSystemPromptOverride?: string;
  ephemeralContext?: string;
  firstUserSend?: boolean;
  attachmentWorkspacePaths?: string[];
  modelContextLimit?: number | null;
}): Promise<{ composed: string; injectionBlocks: Awaited<ReturnType<typeof resolveOutboundSystemMessages>>['injectionBlocks'] }> {
  const override = input.composedSystemPromptOverride?.trim();
  let composed = override ?? '';
  let injectionBlocks: Awaited<ReturnType<typeof resolveOutboundSystemMessages>>['injectionBlocks'] = {
    brainNotes: null,
    codeMap: null,
    contextDocuments: null,
  };
  if (!composed) {
    const legacy =
      typeof document !== 'undefined'
        ? (document.getElementById('systemPrompt') as HTMLTextAreaElement | null)
            ?.value?.trim() ?? ''
        : '';
    let skillBody: string | null = input.skillBody?.trim() ? input.skillBody : null;
    if (!skillBody && input.skillId) {
      const skill = await resolveActiveSkill(input.skillId);
      if (skill?.body?.trim()) skillBody = skill.body;
    }
    if (skillBody && shouldComposeImpeccableBody(input.skillId ?? null, input.userText) && !input.skillBody) {
      skillBody = await composeImpeccableSkillBody(skillBody, input.userText);
    }
    if (skillBody && input.skillId === CAVEMAN_SKILL_ID && !input.skillBody) {
      skillBody = augmentCavemanSkillBody(skillBody, {
        userText: input.userText,
        pinnedIntensity: input.chat.pinnedSkill?.intensity,
      });
    }
    if (skillBody && input.skillId === PARTYMODE_SKILL_ID && !input.skillBody) {
      skillBody = augmentPartyModeSkillBody(skillBody);
    }
    const uiDesignerCtx = prepareUiDesignerTurn(input.chat, {
      skillId: input.skillId ?? null,
      userText: input.userText,
      workAgentId: input.chat.workAgentId,
    });
    if (skillBody && uiDesignerCtx.active) {
      skillBody = augmentSkillBodyForUiDesigner(skillBody, uiDesignerCtx);
    }
    const outbound = await resolveOutboundSystemMessages(input.chat, legacy, {
      userMessagePreview: input.userText || input.rawText,
      routeUserText: input.userText || input.rawText,
      firstUserSend: input.firstUserSend,
      attachmentWorkspacePaths: input.attachmentWorkspacePaths,
      modelContextLimit: input.modelContextLimit,
      overrides: skillBody ? { skillBody } : undefined,
    });
    composed = outbound.composed.trim() || legacy;
    injectionBlocks = outbound.injectionBlocks;
    if (outbound.userRules?.trim()) {
      composed = composed
        ? `${composed}\n\n---\n\n${outbound.userRules.trim()}`
        : outbound.userRules.trim();
    }
  }
  const ephemeral = input.ephemeralContext?.trim();
  if (ephemeral) {
    composed = composed ? `${composed}\n\n${ephemeral}` : ephemeral;
  }
  return { composed, injectionBlocks };
}

function asToolArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

/**
 * Copy runner assistant/tool rows into the chat. Skip system + inner-loop
 * user nudges — those are sub-agent continuation, not product transcript.
 */
export function appendIsolatedProductRows(
  chat: Chat,
  isolated: TranscriptMessage[],
): void {
  for (const msg of isolated) {
    if (msg.role === 'assistant' || msg.role === 'tool') {
      chat.history.push(msg as Message);
    }
  }
}

/**
 * P6-D: every product send goes through `runTurn`. Kept so older tests that
 * called `maybeRunChatTurnViaRunner` still drive the adapter.
 */
export async function maybeRunChatTurnViaRunner(
  input: RunChatTurnOptions,
): Promise<boolean> {
  await runChatTurn(input);
  return true;
}

/**
 * Product chat turn: overlays (Super Plan, resume, attachments, skills,
 * titles, synthesis) around `runTurn()`. Not a second stream/tool loop.
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

  await ensureChatHistoryLoaded(chat.id);
  requireHistory(chat);

  if (!beginChatTurnSetup(chat.id)) {
    return;
  }

  let turnRunId: TurnRunId | undefined;
  let turnMountPinned = false;
  let turnTeardownRan = false;
  let completedNormally = false;
  let thoughtController: ThoughtBubbleController | null = null;
  let thinkingTracker: ThinkingDurationTracker | null = null;
  let wrap: HTMLDivElement | undefined;
  let bubble: HTMLDivElement | undefined;
  let cursor: HTMLDivElement | undefined;
  let streamStatus: StreamingStatusHandle | undefined;
  let painter: ChatTurnEventPainter | undefined;
  let store: ChatTranscriptStore | undefined;
  // Default failed so a throw before we classify still records a failed run.
  let turnRunStatus: TurnRunStatus = 'failed';
  let turnStopReason: ChatStopReason | undefined;
  let turnErrorMessage: string | undefined;
  const savedWorkAgentId = chat.workAgentId;
  let uiDesignerActive = false;
  let sendModelId = '';
  let sendProviderId = '';
  let ownsComposer = false;
  let sentAttachments: Attachment[] = [];
  let releaseTickedMotion: (() => void) | null = null;
  let streamingStatsPublisher: ReturnType<typeof createStreamingStatsPublisher> | null = null;
  const ledgerWrites: Promise<void>[] = [];

  try {
    if (skillId === GIT_SETUP_SKILL_ID && !resumeGenerationId) {
      await prepareGitSetupTurn();
    }

    const useActiveChatDom = chat.id === getActiveChat().id;
    if (useActiveChatDom) {
      setTurnChatMount(getActiveChatMountElement());
      turnMountPinned = true;
    }

    if (replaySnapshot) {
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
    if (!modelId && !resumeGenerationId) {
      throw new Error('No model selected for this chat');
    }

    getChatAbort(chat.id)?.abort();
    const controller = new AbortController();
    setChatAbort(chat.id, controller);
    const chatSignal = controller.signal;

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
      const persistedImages = persistableUserImages(validAttachments);
      if (pushedUserRow.role === 'user' && persistedImages.length > 0) {
        pushedUserRow.images = persistedImages;
      }
      chat.history.push(pushedUserRow);
      recordChatMessage(chat);
      scheduleSaveSessions();
      const pushedUserIdx = chat.history.length - 1;
      if (validAttachments.length > 0) {
        void linkSentAttachmentsToTurn(chat.id, String(pushedUserIdx), validAttachments);
      }
      if (!hideUserEcho) {
        renderSidebar();
        if (isStreamDomVisible(chat.id)) {
          const { wrap: userWrap } = appendBubble(
            'user',
            historyContent,
            {
              historyIndex: pushedUserIdx,
              turnKind: 'user',
              chatId: chat.id,
            },
            { liveAttachments: validAttachments },
          );
          const { attachMessageActions } = await import('../ui/message-actions');
          attachMessageActions(userWrap, {
            chatId: chat.id,
            historyIndex: pushedUserIdx,
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
    const uiDesignerCtx = prepareUiDesignerTurn(chat, {
      skillId,
      userText,
      workAgentId: chat.workAgentId,
    });
    uiDesignerActive = uiDesignerCtx.active;
    if (uiDesignerCtx.active) {
      chat.workAgentId = UI_DESIGNER_AGENT_ID;
    }

    sendModelId = modelId || chat.modelId || '';
    sendProviderId = chat.providerId ?? '';
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
            const task = group.orchestrateBoard.tasks.find((t) => t.id === boardTaskId);
            if (task) task.error = err.message;
          }
        }
        return;
      }
      throw err;
    }

    chat.modelId = sendModelId;
    chat.providerId = sendProviderId;

    // My Models: keep library ids for ensure; remap to llama/mlx after a live serve.
    const cached = await fetchCachedModels().catch(() => []);
    const library = await loadableLibraryFromCached(cached);
    const serves = await listModelServes().catch(() => []);
    const libraryModelId = resolveLibraryModelIdForChatBinding(
      chat.providerId,
      chat.modelId,
      library,
    );
    let libraryEnsure: { providerId: string; modelId: string } | null = null;
    let pendingModelLoad = false;

    if (libraryModelId != null) {
      libraryEnsure = { providerId: LIBRARY_MODEL_PROVIDER_ID, modelId: libraryModelId };
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
        sendProviderId = resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, libraryModelId);
        const libRow = library.find((m) => m.id === libraryModelId);
        if (libRow?.format === 'MLX' && libRow.path?.trim() && sendModelId.trim().startsWith('mlx:')) {
          sendModelId = libRow.path.trim();
        }
      }
    }

    let provider = await getActiveProvider(sendProviderId);
    if (libraryModelId == null) {
      pendingModelLoad = chatTurnNeedsModelLoad(provider, sendModelId);
    }

    const mainTurnLabel = uiDesignerCtx.active
      ? 'UI Designer'
      : activeWorkAgent?.label?.trim() || 'Main turn';
    emitMainTurnActivity({
      chatId: chat.id,
      phase: pendingModelLoad ? 'loading_model' : 'generating',
      currentTool: null,
      workAgentLabel: mainTurnLabel,
      modelId: sendModelId,
      providerId: sendProviderId,
      startedAtMs: Date.now(),
    });

    if (ownsGlobalStreaming) {
      setStreaming(true, chat.id);
    }
    if (isStreamDomVisible(chat.id)) {
      setStatus(
        'spin',
        pendingModelLoad
          ? 'Loading model…'
          : uiDesignerCtx.active
            ? `${uiDesignerCtx.statusHint}…`
            : 'Generating reply…',
      );
    }

    if (pendingModelLoad) {
      const ensureProviderId = libraryEnsure?.providerId ?? sendProviderId;
      const ensureModelId = libraryEnsure?.modelId ?? sendModelId;
      await ensureChatModelLoadedForTurn(ensureProviderId, ensureModelId, chatSignal);
      if (libraryEnsure) {
        const cachedAfter = await fetchCachedModels().catch(() => []);
        const libraryAfter = await loadableLibraryFromCached(cachedAfter);
        const servesAfter = await listModelServes().catch(() => []);
        const served = resolveLibrarySendBinding(libraryEnsure.modelId, libraryAfter, servesAfter);
        if (!served) {
          throw new Error('Failed to load My Models model — no running serve after load');
        }
        sendProviderId = served.providerId;
        sendModelId = served.modelId;
      }
      provider = await getActiveProvider(sendProviderId);
      if (isStreamDomVisible(chat.id)) {
        setStatus('spin', 'Generating reply…');
      }
    }

    const streamRow = appendStreamingAssistantRow(chat.id);
    wrap = streamRow.wrap;
    bubble = streamRow.bubble;
    cursor = streamRow.cursor;
    streamStatus = streamRow.streamStatus;

    // Live thinking timer (loop.ts:1949–1953). The store has its own tracker
    // for persist duration; this one drives the elapsed suffix and toggle.
    thinkingTracker = new ThinkingDurationTracker((elapsedMs) => {
      if (!isStreamDomVisible(chat.id)) return;
      thoughtController?.setThinkingElapsed(elapsedMs);
      streamStatus?.setThinkingElapsed(elapsedMs);
    });

    let awaitingProse = true;
    const revealProse = (): void => {
      awaitingProse = false;
      if (!isStreamDomVisible(chat.id) || !wrap || !bubble) return;
      revealAssistantProseBubble(wrap, bubble, streamStatus);
    };

    const thoughtPhaseCallbacks: ThoughtPhaseCallbacks = {
      onThinkingStart: (): void => {
        patchMainTurnActivity(chat.id, { phase: 'thinking', currentTool: null });
        if (isStreamDomVisible(chat.id)) {
          streamStatus?.setPhase('thinking');
        }
        setSidebarStreamPhase('thinking', chat.id);
        thinkingTracker?.startSegment();
      },
      onReasoningEnded: (): void => {
        thinkingTracker?.endSegment();
        if (isStreamDomVisible(chat.id)) {
          streamStatus?.setThinkingElapsed(null);
          if (awaitingProse) {
            streamStatus?.setPhase('generating');
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

    thoughtController = new ThoughtBubbleController(wrap, thoughtPhaseCallbacks);
    const liveThoughts = thoughtController;

    const beginNextStreamingRow = (): Partial<ChatTurnPaintHost> | void => {
      const nextRow = appendStreamingAssistantRow(chat.id);
      wrap = nextRow.wrap;
      bubble = nextRow.bubble;
      cursor = nextRow.cursor;
      streamStatus = nextRow.streamStatus;
      thoughtController?.setAssistantWrap(wrap);
      thoughtController?.resetStreamPhaseHints();
      awaitingProse = true;
      if (isStreamDomVisible(chat.id)) {
        setStatus('spin', 'Generating reply…');
      }
      patchMainTurnActivity(chat.id, { phase: 'generating', currentTool: null });
      return {
        wrap,
        bubble,
        cursor,
        streamStatus,
        thoughtController: thoughtController ?? undefined,
        revealProse,
      };
    };

    const stampLiveRowHistoryIndex = (row: HTMLElement): number | undefined => {
      const histIdx = store?.lastAssistantHistoryIndex();
      if (histIdx === undefined || !row.isConnected) return histIdx;
      row.dataset.historyIndex = String(histIdx);
      return histIdx;
    };

    // Live strip: schedule from the coalesced paint so a token burst is one
    // snapshot of already-held cumulative strings, not a thought-bubble join.
    streamingStatsPublisher = createStreamingStatsPublisher(chat);
    let statsT0 = 0;
    let statsTFirst: number | null = null;
    // Real provider usage/stats from P10-B `stream_meta` — never `{}` mid-stream.
    let liveStreamMeta: StreamMetaAccumulator = {};
    // Completed rounds, same fields loop.ts fed the publisher as priorSegments.
    const turnUsageSegments: Usage[] = [];
    const turnStatsSegments: Array<{ stats: Stats; usage: Usage }> = [];
    // Box so post-await reads see callback writes (TS does not track those).
    const metricsState: {
      lastRound: { stats: Stats; usage: Usage; model_info: ModelInfo } | null;
      streamModelId: string;
    } = { lastRound: null, streamModelId: '' };
    // Inner loop records via deps.recordTurnUsage; fake tests only emit round_end.
    let recordedUsageViaDeps = false;
    let recordedRoundUsage = false;
    const publishLiveStats = (
      snap: { lastDelta: string; lastThinking: string },
      flush: boolean,
      streamMeta: StreamMetaAccumulator = liveStreamMeta,
    ): void => {
      const input = {
        streamMeta,
        t0: statsT0 || performance.now(),
        tFirst: statsTFirst,
        partialText: snap.lastDelta,
        // Length only — P7-C: never join thought-bubble segments here.
        partialThinkingLength: snap.lastThinking.length,
        priorSegments: turnUsageSegments,
        priorStatsSegments: turnStatsSegments,
        modelId: metricsState.streamModelId || sendModelId,
        modelInfo: chat.modelInfo ?? undefined,
      };
      if (flush) streamingStatsPublisher?.flush(input);
      else streamingStatsPublisher?.schedule(input);
    };
    const appendLiveRowStats = (row: HTMLElement, stats: Stats, usage: Usage): void => {
      if (!row.isConnected || !isStreamDomVisible(chat.id)) return;
      // Rebuilds from history also call appendStats; drop a live duplicate first.
      row.querySelector('.msg-stats')?.remove();
      appendStats(row, stats, usage);
    };
    const recordRoundLedger = (
      streamMeta: StreamMetaAccumulator,
      t0: number,
      tFirst: number | null,
      tEnd: number,
    ): void => {
      if (!hasMeasurableUsage(streamMeta.usage)) return;
      recordedRoundUsage = true;
      ledgerWrites.push(
        recordMainChatTurnUsage(chat, {
          providerId: sendProviderId || provider.id,
          modelId: metricsState.streamModelId || sendModelId,
          streamMeta,
          t0,
          tFirst,
          tEnd,
          workAgentId: activeWorkAgent?.id ?? null,
        }),
      );
    };

    // Serialized tool calls for the context ring. Updated on tool_call, not per token.
    const pendingToolCallsForContext: Array<{
      id?: string;
      name: string;
      arguments?: unknown;
    }> = [];

    const writeLiveContextOverlay = (snap?: {
      lastDelta?: string;
      lastThinking?: string;
    }): void => {
      const painterSnap = painter?.snapshot();
      // Coalesced paint + tool_call only — never from raw delta events (P7-B).
      syncTurnContextUsage({
        chatId: chat.id,
        partialAssistantText: snap?.lastDelta ?? painterSnap?.lastDelta,
        thinkingText: snap?.lastThinking ?? painterSnap?.lastThinking,
        pendingToolCallsJson:
          pendingToolCallsForContext.length > 0
            ? JSON.stringify(pendingToolCallsForContext)
            : undefined,
      });
      scheduleContextUsageRefresh({ duringStream: true });
    };

    painter = createChatTurnEventPainter({
      wrap: streamRow.wrap,
      bubble: streamRow.bubble,
      cursor: streamRow.cursor,
      streamStatus: streamRow.streamStatus,
      thoughtController: liveThoughts,
      mount: getActiveChatMountElement(),
      chatId: chat.id,
      revealProse,
      onActivity: () => notifyChatStreamActivity(chat.id),
      onCoalescedPaint: (snap) => {
        publishLiveStats(snap, false);
        // Once per rAF tick — the grain P7-B exists to keep (P10-I).
        writeLiveContextOverlay(snap);
      },
      modeId: chat.modeId,
      finalizeThinkingRound: () => thinkingTracker?.finalizeRound() ?? 0,
      beginNextStreamingRow,
      onRoundFinalized: ({ wrap: closedWrap, connected }) => {
        if (!connected || !isStreamDomVisible(chat.id)) return;
        // Per-message footer on the closed live row before any history rebuild.
        if (metricsState.lastRound) {
          appendLiveRowStats(closedWrap, metricsState.lastRound.stats, metricsState.lastRound.usage);
        }
        const histIdx = stampLiveRowHistoryIndex(closedWrap);
        if (histIdx === undefined) return;
        void import('../ui/message-actions').then(({ attachMessageActions }) => {
          attachMessageActions(closedWrap, {
            chatId: chat.id,
            historyIndex: histIdx,
            turnKind: 'assistant-tools',
          });
        });
        if (isStreamDomVisible(chat.id)) {
          setStatus('spin', 'Running tools…');
        }
      },
    });

    // Local inference shares the GPU with the compositor; cloud must not acquire.
    if (isLocalProvider(provider)) {
      releaseTickedMotion = acquireTickedMotion();
    }

    registerStreamDomRemount(chat.id, (row) => {
      wrap = row.wrap;
      bubble = row.bubble;
      cursor = row.cursor;
      streamStatus = row.streamStatus;
      thoughtController?.setAssistantWrap(wrap);
      painter?.retarget({
        wrap,
        bubble,
        cursor,
        streamStatus,
        mount: getActiveChatMountElement(),
        thoughtController: thoughtController ?? undefined,
        revealProse,
      });
    });

    let systemPrompt = 'You are a helpful assistant.';
    let injectionBlocks: Awaited<ReturnType<typeof composeRunTurnChatSystemPrompt>>['injectionBlocks'] = {
      brainNotes: null,
      codeMap: null,
      contextDocuments: null,
    };
    try {
      const composed = await composeRunTurnChatSystemPrompt({
        chat,
        rawText,
        userText,
        skillId,
        skillBody: presetSkillBody,
        composedSystemPromptOverride:
          composedSystemPromptOverride?.trim() || replaySnapshot?.composedSystemPrompt,
        ephemeralContext,
        firstUserSend: firstUserSendForInjections,
        attachmentWorkspacePaths: validAttachments
          .map((a) => a.workspacePath?.trim())
          .filter((p): p is string => Boolean(p)),
        modelContextLimit: sendModelId ? resolveContextLimit(sendModelId, chat) : null,
      });
      if (composed.composed.trim()) systemPrompt = composed.composed;
      injectionBlocks = composed.injectionBlocks;
    } catch (err) {
      // Missing prompt config must not fail a plain turn; exploding
      // attachments (abandoned-turn test) must still propagate after cleanup.
      if (err instanceof Error && /setup exploded/i.test(err.message)) throw err;
      if (validAttachments.some((a) => {
        try {
          return Boolean(a.workspacePath);
        } catch (inner) {
          throw inner;
        }
      })) {
        throw err;
      }
    }

    if (pushUser) {
      const injectionAdded = appendInjectionNoticesForTurn(chat, injectionBlocks);
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

    // Replay-prior-reasoning is a buildApiMessages option; inner runner owns
    // thinking. Fetch once so a later caller overlay can use it if needed.
    await fetchReplayPriorReasoningEnabled().catch(() => false);

    if (!resumeGenerationId) {
      const forkHistoryIndex = resolveForkHistoryIndex(chat, pushUser);
      const userRow = chat.history[forkHistoryIndex];
      const userContent =
        userRow && userRow.role === 'user' ? userRow.content : historyContent;
      let snapTools = getEnabledToolDefinitionsForChat(chat, { skillId });
      if (activeWorkAgent?.allowedTools?.length) {
        const allow = new Set(activeWorkAgent.allowedTools);
        snapTools = snapTools.filter((t) => allow.has(t.function.name));
      }
      snapTools = applyUiDesignerToolFilter(snapTools, uiDesignerCtx);
      const enabledToolNames = snapTools.map((t) => t.function.name);
      const globalSampler = mergeGlobalSamplerWithLibraryModel(
        readGlobalSamplerForSend(
          replaySnapshot
            ? {
                temperature: replaySnapshot.temperature,
                maxTokens: replaySnapshot.maxTokens,
              }
            : undefined,
        ),
        sendModelId,
      );
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

      if (replaySnapshot) {
        const run = createRun(chat, replaySnapshot, {
          parentRunId,
          parentTurnId: undefined,
          overrides: forkOverrides,
        });
        turnRunId = run.runId;
      } else {
        const snapshot = await buildTurnSnapshot({
          chat,
          forkHistoryIndex,
          composedSystemPrompt: systemPrompt,
          enabledToolNames,
          providerId: sendProviderId,
          modelId: sendModelId,
          temperature:
            resolvedSampler.preset.temperature ??
            globalSampler.preset.temperature ??
            0.7,
          maxTokens: resolvedSampler.maxTokens,
          thinkingMode: resolvedThinking.mode,
          skillId,
          userContent,
        });
        const run = createRun(chat, snapshot, {
          parentRunId,
          parentTurnId: undefined,
          overrides: forkOverrides,
        });
        turnRunId = run.runId;
      }
      if (turnRunId) {
        await capturePreTurnSnapshot(chat, turnRunId);
      }
      scheduleSaveSessions();
    }

    ownsComposer = pushUser && !hideUserEcho && useActiveChatDom;
    sentAttachments = ownsComposer ? getPendingAttachments() : [];
    if (sentAttachments.length > 0) {
      clearAttachments();
    }

    let tools: RunTurnOptions['tools'] = [];
    try {
      tools = chatToolDefinitionsForTurn(chat, skillId);
    } catch {
      tools = spikeChatToolDefinitions();
    }
    if (tools.length === 0) tools = spikeChatToolDefinitions();

    const chatStore = createChatTranscriptStore({
      thoughtController: liveThoughts,
      turnRunId,
    });
    store = chatStore;
    const deps = createRendererRunnerDeps(chatStore);
    // Inner loop would otherwise attribute this completion to a sub-agent
    // helper (`recordSubAgentTurnUsage`). Record as main-chat instead.
    deps.recordTurnUsage = async (_input, turn) => {
      const payload = turn as {
        providerId?: string;
        modelId?: string;
        streamMeta?: StreamMetaAccumulator;
        t0?: number;
        tFirst?: number | null;
        tEnd?: number;
      };
      if (!payload?.streamMeta || !hasMeasurableUsage(payload.streamMeta.usage)) return;
      recordedUsageViaDeps = true;
      recordRoundLedger(
        payload.streamMeta,
        Number.isFinite(payload.t0) ? (payload.t0 as number) : performance.now(),
        payload.tFirst ?? null,
        Number.isFinite(payload.tEnd) ? (payload.tEnd as number) : performance.now(),
      );
    };

    // Main chat persists generations so boot resume can re-subscribe. First
    // post of a resume turn subscribes; later tool rounds POST a new generation.
    let resumeId = resumeGenerationId?.trim() || '';
    deps.postChatCompletions = async (prov, body, signal, postOptions) => {
      const next: PostChatCompletionsOptions = {
        ...postOptions,
        persist: true,
        fallbackRole: postOptions?.fallbackRole ?? 'main-chat',
        chatId: chat.id,
        onGenerationId: (id) => {
          chat.currentGenerationId = id;
          chatStore.noteGeneration(chat.id, id);
          postOptions?.onGenerationId?.(id);
        },
      };
      if (resumeId) {
        next.resumeGenerationId = resumeId;
        resumeId = '';
      }
      try {
        return await postChatCompletions(
          prov as unknown as Parameters<typeof postChatCompletions>[0],
          body as unknown as Parameters<typeof postChatCompletions>[1],
          signal,
          next,
        );
      } catch (err) {
        const { GenerationNotFoundError } = await import('../api/generations');
        if (err instanceof GenerationNotFoundError) {
          chat.currentGenerationId = undefined;
          scheduleSaveSessions();
        }
        throw err;
      }
    };

    const needsOverlay = chatTurnNeedsMultimodalOverlay(chat, validAttachments);
    const priorMessages = needsOverlay
      ? overlayMultimodalHistoryForRunTurn(chat, {
          modelId: sendModelId,
          vision: canSendImagesToModel(sendModelId),
          pendingUserText: userText || rawText,
          attachments: validAttachments,
        })
      : undefined;
    // Match the user row already pushed (`historyContent`, including skill
    // tags). `userText` is the pre-tag body — using it here duplicates the
    // send as a second user bubble. Continue-after-truncation still wins.
    const seed =
      ephemeralContinueInstruction?.trim() ||
      (priorMessages ? '' : historyContent);

    statsT0 = performance.now();
    // Consecutive parallel-safe `tool_call`s in one round (all emitted before
    // execute) share one activity label — a 6-wide read batch should not flash
    // the last tool name (P10-H / MIN-773).
    let parallelSafeStreak = 0;

    const result = await runTurnImpl({
      chatId: chat.id,
      seed,
      seedKind: 'continue',
      ...(priorMessages ? { messages: priorMessages as TranscriptMessage[] } : {}),
      systemPrompt,
      tools,
      model: {
        providerId: provider.id,
        id: sendModelId,
        thinking:
          chat.thinkingMode === 'off' || chat.thinkingMode === 'on'
            ? { mode: chat.thinkingMode }
            : undefined,
      },
      onEvent: (event) => {
        chatStore.observe(event);
        if (event.type === 'round_start') {
          // Each API round has its own t0 / usage; do not inherit the last one.
          liveStreamMeta = {};
          statsT0 = performance.now();
          statsTFirst = null;
          parallelSafeStreak = 0;
        }
        if (
          statsTFirst == null &&
          (event.type === 'delta' || event.type === 'thinking') &&
          event.text
        ) {
          statsTFirst = performance.now();
        }
        if (event.type === 'stream_meta') {
          liveStreamMeta = applyStreamMetaEvent(liveStreamMeta, event);
          if (typeof event.model === 'string' && event.model.trim()) {
            metricsState.streamModelId = event.model.trim();
          }
          // P10-B runtime is timings + prompt_progress, not a label string.
          const runtime = runtimeStatusFromStreamMetaRuntime(
            event.runtime,
            statsTFirst != null,
          );
          if (isStreamDomVisible(chat.id) && streamStatus) {
            if (runtime.phase === 'prompt_processing' && statsTFirst == null) {
              streamStatus.setPhase('prompt_processing');
            }
            streamStatus.setRuntimeDetail(runtime.detail || null);
          }
          // Usage-only snapshot: still length, never a thought-bubble join.
          const snap = painter?.snapshot() ?? { lastDelta: '', lastThinking: '' };
          publishLiveStats(snap, false);
        }
        if (event.type === 'round_end') {
          const roundStreamMeta = streamMetaFromRoundEnd(liveStreamMeta, event);
          // t0 can be 0 in tests; `||` would fall through to wall-clock now.
          const tEnd = Number.isFinite(event.tEnd) ? event.tEnd : performance.now();
          const t0 = Number.isFinite(event.t0) ? event.t0 : statsT0 || tEnd;
          const tFirst = event.tFirst ?? statsTFirst ?? tEnd;
          metricsState.lastRound = finalizeResponseMeta(roundStreamMeta, t0, tFirst, tEnd);
          if (metricsState.lastRound.usage && Object.keys(metricsState.lastRound.usage).length > 0) {
            turnUsageSegments.push(metricsState.lastRound.usage);
            turnStatsSegments.push({
              stats: metricsState.lastRound.stats,
              usage: metricsState.lastRound.usage,
            });
          }
          if (!recordedUsageViaDeps) {
            recordRoundLedger(roundStreamMeta, t0, tFirst, tEnd);
          }
          recordedUsageViaDeps = false;
          // Strip during tool execution shows completed rounds, not a live estimate.
          liveStreamMeta = {};
          publishLiveStats({ lastDelta: '', lastThinking: '' }, true, {});
        }
        if (event.type === 'phase') {
          // thinking / generating come from the runner; do not infer them from
          // tool_call. phase `tools` also fires from onToolCallDelta (args still
          // streaming) — remount needs a stream shell until a real tool_call.
          if (event.phase === 'thinking' || event.phase === 'generating') {
            patchMainTurnActivity(chat.id, {
              phase: event.phase,
              currentTool: null,
            });
          }
        }
        if (event.type === 'tool_streaming') {
          // Args are still streaming — one name is correct until the batch
          // of `tool_call`s arrives and we can see a parallel segment.
          if (parallelSafeStreak <= 1) {
            patchMainTurnActivity(chat.id, { currentTool: event.name });
          }
        }
        if (event.type === 'tool_call') {
          if (isParallelSafeTool(event.name)) {
            parallelSafeStreak += 1;
          } else {
            parallelSafeStreak = 0;
          }
          const aggregate =
            parallelSafeStreak > 1
              ? parallelToolsActivityLabel(parallelSafeStreak)
              : '';
          patchMainTurnActivity(chat.id, {
            phase: 'tools',
            currentTool: aggregate || event.name,
          });
          pendingToolCallsForContext.push({
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
          // Discrete tool_call — once per call with serialized args (P10-I).
          writeLiveContextOverlay();
        }
        // round_end lastRound is set above so onRoundFinalized can appendStats.
        painter?.onEvent(event);
      },
      transcript: chatStore,
      signal: chatSignal,
      deps,
      ask: createChatAskCapability({ chatId: chat.id }),
      askTimeoutMs: resolveSpikeAskTimeoutMs(),
      onRoundBoundary: createChatRoundBoundary(chat),
      injectReportTool: false,
      nudgeToolUse: false,
      finalizeStructuredOutcome: false,
      execute: async (name, args, ctx) => {
        if (name === ASK_QUESTION_TOOL_NAME) {
          return {
            content:
              'Error: ask_question must be handled by the injected ask capability.',
          };
        }
        const planBlock = uiDesignerActive
          ? assertUiDesignerToolAllowed(name, uiDesignerCtx.mode)
          : null;
        if (planBlock) {
          return { content: planBlock };
        }

        const toolLoopModeId = normalizeModeId(chat.modeId);
        // Nested spawn/cancel read this module-level latch. It must be the
        // current tool call, and it must be cleared in `finally` — a leak
        // anchors the next turn's cards to this row (P10-H / MIN-773).
        // P10-K re-anchors the card on upsert if the tool row was rebuilt.
        setSubAgentExecutorContext({
          parentTurnId: turnRunId ?? chat.id,
          modeId: toolLoopModeId,
          parentChatId: chat.id,
          parentToolCallId: ctx.toolCallId,
        });
        setBugBoardExecutorContext({ chatId: chat.id });

        const scopedWorkspaceRoot = resolveChatToolWorkspaceRoot(
          chat,
          sessionState?.groups,
        );
        const toolOut = await executeTool(name, asToolArgs(args), {
          chatId: chat.id,
          toolCallId: ctx.toolCallId,
          modeId: toolLoopModeId,
          workAgentId: chat.workAgentId ?? null,
          signal: chatSignal,
          ...(scopedWorkspaceRoot ? { workspaceRoot: scopedWorkspaceRoot } : {}),
        });
        const payload: {
          content: string;
          attachments?: typeof toolOut.attachments;
          codeChange?: typeof toolOut.codeChange;
        } = {
          content: toolOut.content,
        };
        if (toolOut.attachments?.length) payload.attachments = toolOut.attachments;
        // Persist-time tool rows read attachments/codeChange from TurnEvent.
        if (toolOut.codeChange) payload.codeChange = toolOut.codeChange;
        return payload;
      },
    });

    await Promise.all(ledgerWrites);

    // End-of-turn summed usage is a fallback when no round_end / deps
    // recording happened. Per-round recordMainChatTurnUsage already wrote
    // the same tokens; a second write would double-count the ledger.
    if (result.usage && !recordedRoundUsage) {
      const agent = resolveActiveWorkAgent(chat);
      await recordChatCompletionUsage(chat, {
        source: {
          kind: 'main',
          modeId: normalizeModeId(chat.modeId),
          workAgentId: agent?.id ?? chat.workAgentId ?? null,
        },
        providerId: sendProviderId || provider.id,
        modelId: sendModelId,
        usage: result.usage as Usage,
      });
    }

    const chrome: InterruptedTurnChrome = {
      chat,
      wrap,
      bubble,
      cursor,
      streamStatus,
      thoughtController,
      painter,
      store,
      turnRunId,
      pushUser,
      superPlanStage,
    };

    // Stop is a returned outcome, not a throw. Do not fall through to the
    // success painter — that path never mints `stopped: true`.
    if (isAbortedTurnResult(result, chatSignal)) {
      const settled = settleStoppedTurn(chrome);
      turnRunStatus = 'stopped';
      turnStopReason = settled.stopReason;
    } else if (
      isFailedTurnResult(result) ||
      isGenerationLostMessage('error' in result ? result.error : undefined)
    ) {
      const errText =
        result.outcome === 'timeout'
          ? 'timeout'
          : 'error' in result && result.error.trim()
            ? result.error.trim()
            : result.outcome;
      const settled = settleFailedTurn(chrome, errText);
      turnRunStatus = 'failed';
      turnErrorMessage = settled.errorMessage;
    } else {
      chat.currentGenerationId = undefined;
      recordAssistantReplyOnChat(chat);
      recordChatMessage(chat);
      scheduleSaveSessions();

      painter?.flush();
      const painted = painter?.snapshot() ?? {
        lastDelta: '',
        lastThinking: '',
        toolCallCount: 0,
      };
      // Priors already hold every round; do not pass summed result.usage
      // (that adds prompts across rounds and looks like a huge context).
      publishLiveStats(painted, true, {});
      const displayMeta = turnStatsSegments.length
        ? aggregateTurnMetaSegments(turnStatsSegments)
        : metricsState.lastRound;
      if (displayMeta) {
        chat.lastStats = buildLastStatsSnapshot(displayMeta.stats, displayMeta.usage);
        const modelInfo = resolveModelInfo(
          metricsState.streamModelId || sendModelId,
          metricsState.lastRound?.model_info ?? {},
        );
        chat.modelInfo = { ...modelInfo };
        if (getActiveChat().id === chat.id) {
          updateStrip(displayMeta.stats, displayMeta.usage, modelInfo);
        }
      }
      if (bubble && cursor) {
        cancelAssistantBubbleRenderDebounce(bubble);
        finishStreamingBubbleRender(bubble, cursor);
      }
      const prose = painted.lastDelta.trim();
      const thinkingDurationMs = thinkingTracker?.finalizeRound() ?? 0;
      const hasProse = Boolean(prose);
      if (hasProse && wrap?.isConnected && bubble) {
        revealProse();
        setAssistantBubbleContent(bubble, prose, { streaming: false, modeId: chat.modeId });
        completeStreamAnnouncer(prose);
      }
      if (wrap?.isConnected) {
        finalizeAndAnchorThinkingRound({
          thoughtController,
          wrap,
          streamStatus,
          hasProse,
          durationMs: thinkingDurationMs,
          domVisible: isStreamDomVisible(chat.id),
        });
        if (metricsState.lastRound) {
          appendLiveRowStats(wrap, metricsState.lastRound.stats, metricsState.lastRound.usage);
        }
      } else {
        thoughtController?.consumePersistedSegments();
      }
      if (hasProse && wrap?.isConnected && bubble) {
        const histIdx = stampLiveRowHistoryIndex(wrap);
        if (isStreamDomVisible(chat.id)) {
          const { attachMessageActions } = await import('../ui/message-actions');
          const { attachVoicePlayButton } = await import('../ui/voice-controls');
          if (histIdx !== undefined) {
            attachMessageActions(wrap, {
              chatId: chat.id,
              historyIndex: histIdx,
              turnKind: 'assistant',
            });
          }
          attachVoicePlayButton(wrap, prose);
          const lastMsg =
            histIdx !== undefined ? chat.history[histIdx] : undefined;
          if (
            lastMsg &&
            lastMsg.role === 'assistant' &&
            'truncated' in lastMsg &&
            lastMsg.truncated
          ) {
            markMessageTruncated(wrap, chat);
          }
        }
      } else if (wrap?.isConnected && !hasProse) {
        stampLiveRowHistoryIndex(wrap);
      }
      streamStatus?.dispose();
      if (isStreamDomVisible(chat.id)) {
        setStatus('ok', 'Ready');
        scrollChatIfPinned();
      }
      renderSidebar();

      if (
        (firstUserSendForInjections || deferTitleUntilTurnEnd || shouldScheduleTitle) &&
        (titleSeed || userText || rawText).trim()
      ) {
        scheduleChatTitleGeneration(chat.id, titleSeed || userText || rawText, {
          modelId: sendModelId,
          providerId: sendProviderId || provider.id,
        });
      }

      if (normalizeModeId(chat.modeId) !== 'debug') {
        const lastAssistant = [...chat.history].reverse().find((m) => m.role === 'assistant');
        const assistantText =
          lastAssistant && typeof lastAssistant.content === 'string'
            ? lastAssistant.content
            : '';
        schedulePostTurnSynthesis({
          chatId: chat.id,
          messages: buildSynthesisMessages(chat),
          roundCount: 1,
          toolCount: painted.toolCallCount,
          sourceExcerpt: buildSynthesisExcerpt(chat),
          assistantText,
          boardChat: isBoardOwnedChat(chat) || isBoardTaskChat(chat),
          ...(chat.kind === 'expert' && chat.expertId?.trim()
            ? { expertId: chat.expertId.trim() }
            : {}),
        });
      }

      completedNormally = result.outcome === 'no_report' || result.outcome === 'pass';
      if (completedNormally) turnRunStatus = 'completed';
    }
  } catch (err) {
    const chrome: InterruptedTurnChrome = {
      chat,
      wrap,
      bubble,
      cursor,
      streamStatus,
      thoughtController,
      painter,
      store,
      turnRunId,
      pushUser,
      superPlanStage,
    };
    // Thrown AbortError is the fallback Stop path; the usual Stop is a return.
    if (isAbortError(err) || getChatAbort(chat.id)?.signal.aborted) {
      const settled = settleStoppedTurn(chrome);
      turnRunStatus = 'stopped';
      turnStopReason = settled.stopReason;
    } else {
      const settled = settleFailedTurn(chrome, err);
      turnRunStatus = 'failed';
      turnErrorMessage = settled.errorMessage;
    }
    // Setup failures after the activity row (abandoned-turn) must propagate
    // so callers can distinguish a throw from a crashed outcome.
    if (!turnTeardownRan && err instanceof Error && /setup exploded/i.test(err.message)) {
      throw err;
    }
  } finally {
    turnTeardownRan = true;
    // Nested spawn cards latch onto this module-level parent; a leak
    // would pin the next turn's cards to a stale tool row (P10-H / MIN-773).
    setSubAgentExecutorContext(null);
    setBugBoardExecutorContext(null);
    await Promise.all(ledgerWrites);
    // Drop the live-strip timer; hand looping animations back to vsync.
    streamingStatsPublisher?.reset();
    streamingStatsPublisher = null;
    releaseTickedMotion?.();
    releaseTickedMotion = null;
    thoughtController?.abort();
    thinkingTracker?.abort();
    store?.abortThinking();
    // Drop in-flight tokens so the ring settles to the post-turn estimate.
    setContextInFlightOverlay(null);
    scheduleContextUsageRefresh();
    registerStreamDomRemount(chat.id, null);
    clearMainTurnActivity(chat.id);
    if (uiDesignerActive) {
      chat.workAgentId = savedWorkAgentId;
    }
    if (!completedNormally) {
      restorePendingAttachments(sentAttachments);
    }
    if (turnRunId) {
      const run = findRunById(chat, turnRunId);
      const start = run?.outputHistoryStart;
      const end = run?.outputHistoryEnd;
      finalizeRun(chat, turnRunId, {
        status: completedNormally ? 'completed' : turnRunStatus,
        outputHistoryStart: start,
        outputHistoryEnd: end,
        stopReason: turnRunStatus === 'stopped' ? (turnStopReason ?? 'user') : undefined,
        errorMessage: turnErrorMessage,
      });
      await capturePostTurnSnapshot(chat, turnRunId);
      scheduleSaveSessions();
      if (isStreamDomVisible(chat.id) && run) {
        refreshBranchPickerAtFork(chat, run.forkHistoryIndex);
      }
    }
    if (ownsGlobalStreaming) {
      endStreamingImpl(chat.id);
      setSidebarStreamPhase(null, chat.id);
      syncChatItemDotsInDom();
    }
    if (getChatAbort(chat.id)?.signal) {
      setChatAbort(chat.id, null);
    }
    if (turnMountPinned) {
      setTurnChatMount(null);
    }
    endChatTurnSetup(chat.id);

    if (completedNormally && isPartyModePinned(chat.pinnedSkill) && isStreamDomVisible(chat.id)) {
      burstPartyConfetti();
    }

    if (completedNormally) {
      const leftoverSteer = chat.pendingSteerMessage?.trim() ?? '';
      if (leftoverSteer) {
        // No tool-loop boundary this turn — follow-up send, not abort+resend.
        clearPendingSteer(chat);
        void resumeParentChatWithMessage(chat, leftoverSteer);
      } else {
        void flushPendingMessageQueue(chat);
        if (goalDriven) {
          void import('./goal/evaluate').then((mod) => {
            void mod.maybeContinueGoalAfterTurn(chat);
          });
        }
        void import('./loop/pacing').then((mod) => {
          mod.maybeRescheduleLoopsAfterTurn(chat);
        });
      }
    }
  }
}

/**
 * Programmatic parent turn (e.g. sub-agent completion push). Skips slash/skill
 * resolution — prefer {@link sendProgrammaticChatText} when the text may include `/skills`.
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
