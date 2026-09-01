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
import { createChatTurnEventPainter } from './run-turn-chat-paint';
import { createStreamingStatsPublisher } from './streaming-stats';
import { setSteerEnqueuedListener, clearPendingSteer } from './steer-message';
import { flushPendingMessageQueue } from './message-queue';
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
  Message,
  TurnRunId,
  TurnSnapshot,
  Usage,
} from '../types';
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
import { recordChatCompletionUsage } from '../usage/record-chat-usage';
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
  appendStreamingAssistantRow,
  removeOrphanStreamingRow,
  revealAssistantProseBubble,
} from '../ui/messages';
import {
  cancelAssistantBubbleRenderDebounce,
  finishStreamingBubbleRender,
  setAssistantBubbleContent,
} from '../markdown/renderer';
import { ThoughtBubbleController, renderThoughtsToggle } from '../ui/thought-bubbles';
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
  let abortedForSteer = false;
  let completedNormally = false;
  let thoughtController: ThoughtBubbleController | null = null;
  const savedWorkAgentId = chat.workAgentId;
  let uiDesignerActive = false;
  let sendModelId = '';
  let sendProviderId = '';
  let ownsComposer = false;
  let sentAttachments: Attachment[] = [];
  let releaseTickedMotion: (() => void) | null = null;
  let streamingStatsPublisher: ReturnType<typeof createStreamingStatsPublisher> | null = null;

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
    let { wrap, bubble, cursor, streamStatus } = streamRow;
    thoughtController = new ThoughtBubbleController(wrap, {
      onThinkingStart: () => {
        if (isStreamDomVisible(chat.id)) streamStatus.setPhase('thinking');
      },
    });

    let awaitingProse = true;
    const revealProse = (): void => {
      awaitingProse = false;
      if (!isStreamDomVisible(chat.id)) return;
      revealAssistantProseBubble(wrap, bubble, streamStatus);
    };

    // Live strip: schedule from the coalesced paint so a token burst is one
    // snapshot of already-held cumulative strings, not a thought-bubble join.
    streamingStatsPublisher = createStreamingStatsPublisher(chat);
    let statsT0 = 0;
    let statsTFirst: number | null = null;
    const publishLiveStats = (
      snap: { lastDelta: string; lastThinking: string },
      flush: boolean,
      streamMeta: { usage?: Usage } = {},
    ): void => {
      const input = {
        streamMeta,
        t0: statsT0 || performance.now(),
        tFirst: statsTFirst,
        partialText: snap.lastDelta,
        partialThinkingLength: snap.lastThinking.length,
        modelId: sendModelId,
        modelInfo: chat.modelInfo ?? undefined,
      };
      if (flush) streamingStatsPublisher?.flush(input);
      else streamingStatsPublisher?.schedule(input);
    };

    const painter = createChatTurnEventPainter({
      wrap,
      bubble,
      cursor,
      streamStatus,
      thoughtController,
      mount: getActiveChatMountElement(),
      revealProse,
      onActivity: () => notifyChatStreamActivity(chat.id),
      onCoalescedPaint: (snap) => publishLiveStats(snap, false),
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
      painter.retarget({
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

    const store = createSessionTranscriptStore();
    const deps = createRendererRunnerDeps(store);
    deps.recordTurnUsage = async () => {};

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
          scheduleSaveSessions();
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

    setSteerEnqueuedListener((steerChatId) => {
      if (steerChatId === chat.id) {
        abortedForSteer = true;
        controller.abort();
      }
    });

    const needsOverlay = chatTurnNeedsMultimodalOverlay(chat, validAttachments);
    const priorMessages = needsOverlay
      ? overlayMultimodalHistoryForRunTurn(chat, {
          modelId: sendModelId,
          vision: canSendImagesToModel(sendModelId),
          pendingUserText: userText || rawText,
          attachments: validAttachments,
        })
      : undefined;
    const seed =
      ephemeralContinueInstruction?.trim() ||
      (priorMessages ? '' : userText);

    statsT0 = performance.now();
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
        if (
          statsTFirst == null &&
          (event.type === 'delta' || event.type === 'thinking') &&
          event.text
        ) {
          statsTFirst = performance.now();
        }
        if (event.type === 'tool_streaming') {
          // Keep phase `generating` so remount still attaches a stream shell
          // (stream-chat-dom skips remount when phase is `tools` = execute).
          patchMainTurnActivity(chat.id, { currentTool: event.name });
        }
        if (event.type === 'tool_call') {
          patchMainTurnActivity(chat.id, {
            phase: 'tools',
            currentTool: event.name,
          });
        }
        painter.onEvent(event);
      },
      transcript: store,
      signal: chatSignal,
      deps,
      ask: createChatAskCapability({ chatId: chat.id }),
      askTimeoutMs: resolveSpikeAskTimeoutMs(),
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
        const toolOut = await executeTool(name, asToolArgs(args), {
          chatId: chat.id,
          toolCallId: ctx.toolCallId,
          signal: chatSignal,
        });
        const payload: { content: string; attachments?: typeof toolOut.attachments } = {
          content: toolOut.content,
        };
        if (toolOut.attachments?.length) payload.attachments = toolOut.attachments;
        return payload;
      },
    });

    if (result.usage) {
      const agent = resolveActiveWorkAgent(chat);
      void recordChatCompletionUsage(chat, {
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

    chat.currentGenerationId = undefined;
    recordAssistantReplyOnChat(chat);
    recordChatMessage(chat);
    scheduleSaveSessions();

    painter.flush();
    const painted = painter.snapshot();
    publishLiveStats(
      painted,
      true,
      result.usage ? { usage: result.usage as Usage } : {},
    );
    cancelAssistantBubbleRenderDebounce(bubble);
    finishStreamingBubbleRender(bubble, cursor);
    const prose = painted.lastDelta.trim();
    const thinkingSegments = thoughtController.consumePersistedSegments();
    if (prose && wrap.isConnected) {
      revealProse();
      setAssistantBubbleContent(bubble, prose, { streaming: false, modeId: chat.modeId });
      completeStreamAnnouncer(prose);
      if (thinkingSegments.length > 0) {
        renderThoughtsToggle(wrap, thinkingSegments);
      }
      wrap.dataset.historyIndex = String(Math.max(0, chat.history.length - 1));
    } else if (wrap.isConnected && awaitingProse && !prose) {
      removeOrphanStreamingRow(wrap, streamStatus);
    }
    streamStatus.dispose();
    // A failed outcome carries its reason in `result.error`; showing the bare
    // outcome word ("crashed") strands the only diagnostic the turn produced.
    const failure =
      result.outcome === 'crashed' || result.outcome === 'timeout'
        ? ('error' in result && typeof result.error === 'string' && result.error.trim()
            ? result.error.trim()
            : result.outcome)
        : null;
    if (failure) {
      console.error(`[chat ${chat.id}] turn ${result.outcome}:`, failure);
    }
    if (isStreamDomVisible(chat.id)) {
      if (failure) {
        setStatus('err', failure);
      } else {
        setStatus('ok', result.outcome === 'no_report' ? 'Done' : result.outcome);
      }
      scrollChatIfPinned();
    }

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isStreamDomVisible(chat.id)) {
      setStatus('err', message);
    }
    // Setup failures after the activity row (abandoned-turn) must propagate
    // so callers can distinguish a throw from a crashed outcome.
    if (!turnTeardownRan && err instanceof Error && /setup exploded/i.test(err.message)) {
      throw err;
    }
    // Generation-lost-on-restart: clear the stale id (resume wrap may have).
    const { GenerationNotFoundError, GENERATION_LOST_ON_RESTART_MESSAGE } =
      await import('../api/generations');
    if (err instanceof GenerationNotFoundError) {
      chat.currentGenerationId = undefined;
      if (isStreamDomVisible(chat.id)) {
        setStatus('err', GENERATION_LOST_ON_RESTART_MESSAGE);
      }
    }
  } finally {
    turnTeardownRan = true;
    // Drop the live-strip timer; hand looping animations back to vsync.
    streamingStatsPublisher?.reset();
    streamingStatsPublisher = null;
    releaseTickedMotion?.();
    releaseTickedMotion = null;
    thoughtController?.abort();
    setSteerEnqueuedListener(null);
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
        status: completedNormally ? 'completed' : 'failed',
        outputHistoryStart: start,
        outputHistoryEnd: end,
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

    const steerText = chat.pendingSteerMessage?.trim() ?? '';
    if (steerText || abortedForSteer) {
      if (steerText) clearPendingSteer(chat);
      if (steerText) {
        void resumeParentChatWithMessage(chat, steerText);
      }
    } else if (completedNormally) {
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
