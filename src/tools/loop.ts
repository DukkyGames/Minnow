/**
 * Tool-aware chat send path (SA-7): streams completions, runs tool_calls loop,
 * and persists assistant / tool messages in session history.
 */

import {
  chatFetchAbort,
  modelCache,
  setChatFetchAbort,
  setStreaming,
  streaming,
} from '../app-state';
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
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
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
  PendingTurn,
  ToolCall,
  ToolCallAccumulator,
} from '../types';
import { beginTurnCheckpoint, type TurnCheckpointHandle } from '../chat/turn-checkpoint';
import { finalizeStoppedTurn } from '../chat/finalize-stopped-turn';
import {
  clearPendingTurn,
  consumeContinueInstructionForNextSend,
  consumePendingContinueSend,
  CONTINUE_INTERRUPTED_INSTRUCTION,
  ensurePendingTurn,
} from '../state/pending-turn';
import { isComposerRecoveryBlocked } from '../ui/composer-send';
import {
  dismissPendingTurnRecovery,
  showPendingTurnRecoveryManual,
} from '../ui/pending-turn-recovery';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import { setComposerStreamingMode } from '../ui/composer-send';
import { refreshExpertSelectDisabled } from '../ui/expert-select';
import { refreshModeSelectorDisabled } from '../ui/mode-selector';
import {
  appendBubble,
  appendStats,
  appendStreamingAssistantRow,
  revealAssistantProseBubble,
} from '../ui/messages';
import { renderThoughtsToggle, ThoughtBubbleController } from '../ui/thought-bubbles';
import { ThinkingDurationTracker } from '../ui/thinking-duration';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import { renderSidebar } from '../ui/sidebar';
import { postChatCompletions } from '../providers/fetch-chat';
import { getActiveProvider } from '../providers/store';
import { setStatus } from '../ui/status';
import { buildLastStatsSnapshot, updateStrip } from '../ui/stats';
import { resolveOutboundSystemMessages } from '../chat/prompts/compose-context';
import { estimateTokensFromText } from '../chat/prompts/token-estimate';
import { pushOutboundSystemMessages } from './api-system-messages';
import { normalizeModeId } from '../chat/modes/types';
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
import { setSubAgentExecutorContext } from './sub-agent-executor';
import { indexOfLastUserMessage } from '../chat/history-truncate-core';
import {
  formatHistoryWithSkillTag,
  parseSlashCommand,
  resolveActiveSkill,
} from '../skills';

/** Maximum assistantâ†’tool rounds before aborting with an error. */
export const MAX_TOOL_TURNS = 8;

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
  /** Ephemeral user line for Continue after reload (not stored in history). */
  ephemeralContinueInstruction?: string;
  /** Checkpointed assistant leg to inject before the continue user line (reload resume). */
  pendingTurnResume?: PendingTurn;
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

/** Visible text for API replay of a checkpoint (prose, else reasoning segments). */
function effectivePendingResumeText(pending: PendingTurn): string {
  const trimmed = pending.content?.trim() ?? '';
  if (trimmed.length > 0) {
    return pending.content ?? '';
  }
  if (pending.thinking?.length) {
    return pending.thinking.join('\n\n');
  }
  return '';
}

/** True when the checkpoint carries something we should send to the model. */
function pendingTurnResumeHasApiPayload(pending: PendingTurn): boolean {
  return (
    effectivePendingResumeText(pending).trim().length > 0 ||
    (pending.toolCalls?.length ?? 0) > 0
  );
}

function toolCallsShallowEqual(a: ToolCall[], b: ToolCall[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.id !== b[i]!.id) return false;
    if (a[i]!.function.name !== b[i]!.function.name) return false;
  }
  return true;
}

/**
 * Avoid duplicating an assistant row that is already the last persisted message
 * for this turn (e.g. same partial already flushed to history).
 */
function shouldInjectPendingTurnResume(
  history: Message[],
  pending: PendingTurn,
): boolean {
  if (!pendingTurnResumeHasApiPayload(pending)) {
    return false;
  }
  const last = history[history.length - 1];
  if (!last || last.role === 'user' || last.role === 'tool') {
    return true;
  }
  if (last.role !== 'assistant') {
    return true;
  }
  const asst = last as AssistantToolCallMessage;
  if (asst.tool_calls?.length) {
    if (
      pending.toolCalls?.length &&
      toolCallsShallowEqual(asst.tool_calls, pending.tool_calls) &&
      String(asst.content ?? '').trim() === String(pending.content ?? '').trim()
    ) {
      return false;
    }
    return true;
  }
  return String(asst.content ?? '').trim() !== String(pending.content ?? '').trim();
}

/** Append checkpoint assistant message before the ephemeral continue user line. */
function appendPendingTurnResumeToApiMessages(
  messages: ApiMessage[],
  pending: PendingTurn,
): void {
  const text = effectivePendingResumeText(pending);
  if (pending.toolCalls?.length) {
    messages.push({
      role: 'assistant',
      content: text.trim() ? text : null,
      tool_calls: pending.toolCalls,
    });
    return;
  }
  if (text.trim()) {
    messages.push({ role: 'assistant', content: text });
  }
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
  /** Resume from pendingTurn (Continue after reload). */
  continueFromPending?: boolean;
  /** Ephemeral API user line for continue (not stored in history). */
  ephemeralContinueInstruction?: string;
}

/**
 * Serialize session history for LM Studio, including tool_calls and tool results.
 * Pending attachments on the last user turn become multimodal API content (VLM) or
 * inlined file blocks; history stays string-only with `[image: â€¦]` placeholders.
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
  const pendingResume = options?.pendingTurnResume;
  if (continueLine && pendingResume && shouldInjectPendingTurnResume(chat.history, pendingResume)) {
    appendPendingTurnResumeToApiMessages(messages, pendingResume);
  }
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
 * Stream one completion request; accumulate text, tool_call deltas, and usage meta.
 */
async function streamCompletionTurn(
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
  body: ChatCompletionBody,
  bubble: HTMLDivElement,
  cursor: HTMLDivElement,
  signal: AbortSignal,
  thoughtController: ThoughtBubbleController | null,
  onFirstProseDelta?: () => void,
  onPartialText?: (fullText: string) => void,
  onStreamConnected?: () => void,
): Promise<StreamTurnResult> {
  const res = await postChatCompletions(provider, body, signal);

  if (res.ok) {
    onStreamConnected?.();
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};
  const t0 = performance.now();
  let tFirst: number | null = null;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
      scheduleAssistantBubbleRender(bubble, fullText, cursor);
    }
    scrollChatIfPinned();
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    parseSsePayloads(lines.join('\n'), handleChunk);
  }

  if (buffer.trim()) parseSsePayloads(buffer, handleChunk);

  onPartialText?.(fullText);

  // Flush any trailing reasoning when the stream ends (e.g. tool_calls with no prose yet).
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
    continueFromPending = false,
    ephemeralContinueInstruction,
  } = options;

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
  setSubAgentExecutorContext({
    parentTurnId,
    modeId: normalizeModeId(chat.modeId),
    parentChatId: chat.id,
  });

  chat.modelId = modelId || chat.modelId;

  const pendingResume = continueFromPending
    ? ensurePendingTurn(chat.pendingTurn)
    : undefined;
  const turnStartedAt = pendingResume?.startedAt ?? Date.now();

  if (pushUser) {
    chat.history.push({ role: 'user', content: historyContent });
    touchChat(chat);
    scheduleSaveSessions();
    renderSidebar();
    const userIdx = chat.history.length - 1;
    const { wrap: userWrap } = appendBubble('user', historyContent, {
      historyIndex: userIdx,
      turnKind: 'user',
      chatId: chat.id,
    });
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
  let sendModelId = pendingResume?.modelId || modelId || chat.modelId;
  let sendProviderId = pendingResume?.providerId || chat.providerId;

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

  const agentStatusSuffix = uiDesignerCtx.active
    ? ' (UI Designer)'
    : activeWorkAgent?.label
      ? ` (${activeWorkAgent.label})`
      : '';

  setStreaming(true);
  refreshModeSelectorDisabled();
  refreshExpertSelectDisabled();
  setComposerStreamingMode('streaming');
  let livePartialText = '';
  let currentToolRound = pendingResume?.toolRound ?? 0;
  setStatus(
    'spin',
    uiDesignerCtx.active
      ? `${uiDesignerCtx.statusHint}…`
      : `Generating reply${agentStatusSuffix}…`,
  );

  let streamRow = appendStreamingAssistantRow();
  let { wrap, bubble, cursor, streamStatus } = streamRow;
  const streamCtx = { wrap, streamStatus };
  let revealProse = (): void =>
    revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);

  let completedNormally = false;
  let lastWrap = wrap;
  let thoughtController: ThoughtBubbleController | null = null;
  let thinkingTracker: ThinkingDurationTracker | null = null;

  thinkingTracker = new ThinkingDurationTracker((elapsedMs) => {
    streamCtx.streamStatus.setThinkingElapsed(elapsedMs);
  });

  const thoughtPhaseCallbacks = {
    onThinkingStart: (): void => {
      streamCtx.streamStatus.setPhase('thinking');
      thinkingTracker?.startSegment();
      turnCheckpoint?.setPhase('thinking');
    },
    onReasoningEnded: (): void => {
      thinkingTracker?.endSegment();
      streamCtx.streamStatus.setThinkingElapsed(null);
      if (streamCtx.wrap.classList.contains('msg--awaiting-prose')) {
        streamCtx.streamStatus.setPhase('generating');
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

  let turnCheckpoint: TurnCheckpointHandle | null = null;

  try {
    const provider = await getActiveProvider(sendProviderId);
    thoughtController = new ThoughtBubbleController(wrap, thoughtPhaseCallbacks);
    turnCheckpoint = beginTurnCheckpoint(chat, {
      startedAt: turnStartedAt,
      modelId: sendModelId,
      providerId: sendProviderId,
      thoughtController,
    });
    if (pendingResume?.toolRound != null) {
      turnCheckpoint.setToolRound(pendingResume.toolRound);
    }

    const activeModeId = normalizeModeId(chat.modeId);

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      currentToolRound = turn;
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
        ephemeralContinueInstruction: continueFromPending
          ? ephemeralContinueInstruction
          : undefined,
        pendingTurnResume: continueFromPending ? pendingResume : undefined,
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
      turnCheckpoint.setPhase('streaming');
      turnCheckpoint.setToolRound(turn);
      const turnResult = await streamCompletionTurn(
        provider,
        body,
        bubble,
        cursor,
        chatSignal,
        thoughtController,
        revealProse,
        (text) => {
          livePartialText = text;
          turnCheckpoint?.updateLiveText(text);
        },
        continueFromPending
          ? () => {
              clearPendingTurn(chat);
            }
          : undefined,
      );

      cancelAssistantBubbleRenderDebounce();
      cursor.remove();

      const finishReason =
        turnResult.finishReason ||
        (turnResult.toolCalls.length > 0 ? 'tool_calls' : undefined);

      if (finishReason === 'tool_calls' && turnResult.toolCalls.length > 0) {
        if (turnResult.fullText) {
          revealProse();
          setAssistantBubbleContent(bubble, turnResult.fullText, { streaming: false });
        } else {
          wrap.remove();
        }

        const assistantToolMsg: AssistantToolCallMessage = {
          role: 'assistant',
          content: turnResult.fullText || null,
          tool_calls: turnResult.toolCalls,
        };
        chat.history.push(assistantToolMsg);
        touchChat(chat);
        scheduleSaveSessions();
        turnCheckpoint?.setToolCalls(turnResult.toolCalls);
        turnCheckpoint?.setPhase('tools');

        setStatus('spin', 'Running tools…');

        const area = document.getElementById('chatArea')!;
        const STOPPED_TOOL_MSG = 'Stopped by user.';
        for (let ti = 0; ti < turnResult.toolCalls.length; ti++) {
          if (chatSignal.aborted) {
            for (let sj = ti; sj < turnResult.toolCalls.length; sj++) {
              const skipped = turnResult.toolCalls[sj]!;
              const skipArgs = parseToolArguments(skipped.function.arguments);
              const skipWrap = renderToolCall(skipped.function.name, skipArgs);
              skipWrap.dataset.toolCallId = skipped.id;
              area.appendChild(skipWrap);
              renderToolResult(skipWrap, STOPPED_TOOL_MSG);
              chat.history.push({
                role: 'tool',
                tool_call_id: skipped.id,
                content: STOPPED_TOOL_MSG,
              });
            }
            touchChat(chat);
            scheduleSaveSessions();
            throw new DOMException('Aborted', 'AbortError');
          }

          const tc = turnResult.toolCalls[ti]!;
          const args = parseToolArguments(tc.function.arguments);
          const toolWrap = renderToolCall(tc.function.name, args);
          toolWrap.dataset.toolCallId = tc.id;
          area.appendChild(toolWrap);
          scrollChatIfPinned();

          setSubAgentExecutorContext({
            parentTurnId,
            modeId: normalizeModeId(chat.modeId),
            parentChatId: chat.id,
            parentToolCallId: tc.id,
          });

          const planBlock = uiDesignerCtx.active
            ? assertUiDesignerToolAllowed(tc.function.name, uiDesignerCtx.mode)
            : null;
          const toolOut = planBlock
            ? { content: planBlock }
            : await executeTool(tc.function.name, args, {
                chatId: chat.id,
                toolCallId: tc.id,
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
          scrollChatIfPinned();
        }

        touchChat(chat);
        scheduleSaveSessions();
        renderSidebar();

        if (turn + 1 >= MAX_TOOL_TURNS) {
          setStatus('err', 'Maximum tool turns reached');
          break;
        }

        streamRow = appendStreamingAssistantRow();
        ({ wrap, bubble, cursor, streamStatus } = streamRow);
        streamCtx.wrap = wrap;
        streamCtx.streamStatus = streamStatus;
        lastWrap = wrap;
        revealProse = (): void =>
          revealAssistantProseBubble(streamCtx.wrap, bubble, streamCtx.streamStatus);
        thoughtController.setAssistantWrap(wrap);
        thoughtController.resetStreamPhaseHints();

        setStatus('spin', 'Generating reply…');
        continue;
      }

      let fullText = turnResult.fullText;
      let streamMeta = turnResult.streamMeta;

      if (!fullText) {
        revealProse();
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
        setAssistantBubbleContent(bubble, fullText || 'The model returned no text.', {
          streaming: false,
        });
      } else {
        revealProse();
        setAssistantBubbleContent(bubble, fullText, { streaming: false });
      }

      if (fullText) {
        turnCheckpoint?.complete();
        const meta = finalizeResponseMeta(
          streamMeta,
          turnResult.t0,
          turnResult.tFirst ?? turnResult.tEnd,
          turnResult.tEnd,
        );
        const modelInfo = resolveModelInfo(streamMeta.model || modelId, meta.model_info);
        const thinkingNorm = thoughtController?.getSegmentsNormalized() ?? [];
        const thinkingDurationMs = thinkingTracker?.finalize() ?? 0;
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: fullText,
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
        chat.lastStats = buildLastStatsSnapshot(meta.stats, meta.usage);
        chat.modelInfo = { ...modelInfo };
        chat.modelId =
          (document.getElementById('modelSelect') as HTMLSelectElement).value || chat.modelId;
        touchChat(chat);
        appendStats(lastWrap, meta.stats, meta.usage);
        if (thinkingNorm.length > 0) {
          renderThoughtsToggle(lastWrap, thinkingNorm, {
            durationMs:
              thinkingDurationMs > 0 ? thinkingDurationMs : undefined,
          });
        }
        updateStrip(meta.stats, meta.usage, modelInfo);
        setStatus('ok', 'Ready');
        renderSidebar();
        scheduleSaveSessions();
      }

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
      turnCheckpoint?.dispose();
      finalizeStoppedTurn({
        chat,
        wrap: streamCtx.wrap,
        bubble,
        cursor,
        streamStatus: streamCtx.streamStatus,
        thoughtController,
        partialText: livePartialText,
        parentTurnId,
        startedAt: turnStartedAt,
        modelId: sendModelId,
        providerId: sendProviderId,
        toolRound: currentToolRound,
      });
      if (getActiveChat().id === chat.id) {
        showPendingTurnRecoveryManual(chat);
      }
      return;
    }
    cancelAssistantBubbleRenderDebounce();
    if (cursor.parentElement) cursor.remove();
    revealProse();
    bubble.classList.remove('msg-bubble--md');
    bubble.textContent = `Could not complete this reply: ${e.message ?? 'Unknown error'}`;
    bubble.style.color = 'var(--red)';
    const msg = e.message ?? '';
    const statusMsg = msg.length > 48 ? `${msg.slice(0, 45)}…` : msg;
    const attachHint =
      getPendingAttachments().length > 0 ? ' Attachments kept for retry.' : '';
    setStatus('err', statusMsg + attachHint);
  } finally {
    if (uiDesignerCtx.active) {
      chat.workAgentId = savedWorkAgentId;
    }
    setSubAgentExecutorContext(null);
    thoughtController?.abort();
    thinkingTracker?.abort();
    turnCheckpoint?.dispose();
    if (completedNormally) {
      clearAttachments();
    }
    setStreaming(false);
    refreshModeSelectorDisabled();
    refreshExpertSelectDisabled();
    setComposerStreamingMode('idle');
    if (chatFetchAbort && chatFetchAbort.signal === chatSignal) {
      setChatFetchAbort(null);
    }
    scrollChatIfPinned();
  }
}

/** Send the composer text with tool calling (SSE loop, max {@link MAX_TOOL_TURNS} rounds). */
export async function sendMessageWithTools(): Promise<void> {
  if (streaming) return;
  if (isComposerRecoveryBlocked()) return;

  const continueSend = consumePendingContinueSend();
  const chatEarly = getActiveChat();
  if (continueSend && ensurePendingTurn(chatEarly.pendingTurn)) {
    const instruction =
      consumeContinueInstructionForNextSend() ?? CONTINUE_INTERRUPTED_INSTRUCTION;
    dismissPendingTurnRecovery();
    await runChatTurn({
      chat: chatEarly,
      pushUser: false,
      rawText: '',
      userText: '',
      skillId: null,
      displayText: '',
      historyContent: '',
      validAttachments: [],
      continueFromPending: true,
      ephemeralContinueInstruction: instruction,
    });
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
  const { skillId, userText } = parseSlashCommand(rawText);
  const hasUserText = Boolean(userText.trim());
  if (!rawText && pendingWithoutErrors.length === 0) return;
  if (!skillId && !hasUserText && pendingWithoutErrors.length === 0) return;

  const chat = getActiveChat();
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
