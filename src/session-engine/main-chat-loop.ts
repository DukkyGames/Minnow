/**
 * DOM-less main-chat tool loop for the Session Engine (MIN-359 Phase 1).
 *
 * Generalizes headless/runner.ts patterns and adds what loop.ts has that headless
 * lacks: steer consume at tool-loop boundaries, message-queue flush, mode-switch
 * tools as state mutations, and a goal post-turn hook seam.
 *
 * Gaps vs full loop.ts (documented for Phase 1 honesty):
 * - No multimodal attachments / VLM content
 * - No archive/context-budget policy, thinking budget, or synthesis rounds
 * - Goal evaluator is a simplified auto-continue (no full eval-agent tool suite)
 * - propose_mode_switch queues pendingModeId (no ask_question modal)
 * - ask_question / browser_* remain unavailable server-side (same as headless)
 */

import {
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
  type StreamMetaAccumulator,
} from '../api/chat';
import {
  cancelGeneration,
  createGeneration,
  subscribeToGeneration,
} from '../api/generations';
import { buildHeadlessApiMessages } from '../headless/build-messages';
import {
  executeHeadlessTool,
  getHeadlessToolDefinitions,
} from '../headless/execute-tool';
import { installHeadlessFetch, resolveHeadlessToken } from '../headless/server-context';
import { runHeadlessToolBatch } from '../tools/headless-tool-batch';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import { detectConfigServer } from '../config/storage-mode';
import { detectLocalServer } from '../tools/client';
import { ensureToolConfigReady } from '../tools/config';
import { getActiveProvider } from '../providers/store';
import { applySamplerToBody } from '../agents/sampler-types';
import { BUILT_IN_TOOLS } from '../tools/definitions';
import type { Chat, ChatCompletionChunk, ToolCallAccumulator } from '../types';
import {
  consumePendingSteerEngine,
  executeCreateChatWithModeEngine,
  executeEngineModeTool,
  isEngineModeTool,
  peekOldestQueuedMessage,
  shiftOldestQueuedMessage,
} from './engine-loop-helpers';

/** Browser-catalog board tools that run in-process when the board host is active (MIN-360). */
const BOARD_TOOL_NAMES = new Set([
  'board_init',
  'board_update_task',
  'board_get_state',
  'board_report',
  'board_set_autonomy',
  'delegate_tasks',
]);

/** Sub-agent tools hosted by the engine controller registry (MIN-361). */
const SUB_AGENT_TOOL_NAMES = new Set([
  'spawn_sub_agent',
  'cancel_sub_agent',
  'list_sub_agents',
  'get_sub_agent_status',
]);

export interface EngineMainChatTurnOptions {
  chatId: string;
  signal: AbortSignal;
  modelId?: string;
  providerId?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  goalDriven?: boolean;
  /** Override for tests — inject persistence/mutate without HTTP. */
  deps?: EngineMainChatDeps;
}

export interface EngineMainChatDeps {
  getChat: (chatId: string) => Promise<Chat | null>;
  mutateChat: (
    chatId: string,
    mutator: (chat: Chat) => void,
    opts?: { soft?: boolean },
  ) => Promise<void>;
  /** Session-level mutate (create_chat_with_mode). */
  mutateSession?: (mutator: (state: unknown) => void) => Promise<void>;
  baseUrl?: string;
  token?: string;
  onGoalAfterTurn?: (chat: Chat, goalDriven: boolean) => Promise<void>;
  onFlushQueue?: (chatId: string, text: string) => Promise<void>;
}

const MODE_TOOL_NAMES = new Set([
  'set_chat_mode',
  'create_chat_with_mode',
  'propose_mode_switch',
]);

/** Default deps talk to the live Session Engine via dynamic import (Node only). */
async function defaultDeps(): Promise<EngineMainChatDeps> {
  const { getEngineSessionState, mutateEngineState } = await import(
    '../../server/session/engine-api.js'
  );
  const { findChatInState } = await import('../../server/session/commands.js');
  const { getSchedulerServerBaseUrl } = await import(
    '../../server/scheduler/server-base-url.js'
  );
  const { getSessionToken } = await import('../../server/runtime/session-token.js');
  const { applyCommand } = await import('../../server/session/engine.js');

  return {
    baseUrl: getSchedulerServerBaseUrl(),
    token: getSessionToken(),
    async getChat(chatId) {
      const state = getEngineSessionState();
      return findChatInState(state, chatId) as Chat | null;
    },
    async mutateChat(chatId, mutator, opts) {
      await mutateEngineState((state: unknown) => {
        const chat = findChatInState(state, chatId);
        if (!chat) throw new Error(`Chat not found: ${chatId}`);
        mutator(chat as Chat);
        (chat as Chat).updatedAt = Date.now();
      }, opts);
    },
    async mutateSession(mutator) {
      await mutateEngineState((state: unknown) => {
        mutator(state);
      });
    },
    async onFlushQueue(chatId, text) {
      await applyCommand({
        type: 'send_message',
        chatId,
        text,
      });
    },
    async onGoalAfterTurn(chat, goalDriven) {
      if (!goalDriven || !chat.activeGoal) return;
      let shouldContinue = false;
      let conditionText = '';
      await mutateEngineState((state: unknown) => {
        const row = findChatInState(state, chat.id) as Chat | null;
        if (!row?.activeGoal) return;
        row.activeGoal.turnCount = (row.activeGoal.turnCount ?? 0) + 1;
        conditionText = row.activeGoal.conditionText;
        // Phase 1 seam: auto-continue a few times; full eval-agent lands later.
        shouldContinue = row.activeGoal.turnCount < 3;
        row.updatedAt = Date.now();
      });
      if (shouldContinue && conditionText) {
        await applyCommand({
          type: 'send_message',
          chatId: chat.id,
          text: `Continue working toward the goal: ${conditionText}`,
          goalDriven: true,
        });
      }
    },
  };
}

async function streamEngineTurn(
  providerId: string,
  body: Record<string, unknown>,
  chatId: string,
  signal: AbortSignal,
  onGenerationId: (id: string) => Promise<void>,
): Promise<{
  fullText: string;
  finishReason: string | undefined;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
  generationId: string;
}> {
  const { generationId } = await createGeneration(providerId, body, {
    persist: true,
    fallbackRole: 'main-chat',
    chatId,
  });
  await onGenerationId(generationId);

  let fullText = '';
  let streamMeta: StreamMetaAccumulator = {};
  let toolAcc: ToolCallAccumulator = {};

  function handleChunk(chunk: ChatCompletionChunk): void {
    streamMeta = mergeStreamMeta(streamMeta, chunk);
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const delta = extractStreamDelta(chunk);
    if (delta) fullText += delta;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const unsubscribe = subscribeToGeneration(generationId, {
      signal,
      onChunk: handleChunk,
      onEnd: () => finish(resolve),
      onTransportError: (err) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      },
    });

    signal.addEventListener(
      'abort',
      () => {
        unsubscribe();
        void cancelGeneration(generationId).catch(() => undefined);
        finish(() => reject(new DOMException('Aborted', 'AbortError')));
      },
      { once: true },
    );
  });

  const finishReason =
    streamMeta.finish_reason ||
    (Object.keys(toolAcc).length > 0 ? 'tool_calls' : 'stop');

  return {
    fullText,
    finishReason,
    toolCalls: finalizeToolCalls(toolAcc),
    generationId,
  };
}

function mergeModeToolDefinitions(
  enabledTools: ReturnType<typeof getHeadlessToolDefinitions>,
): ReturnType<typeof getHeadlessToolDefinitions> {
  let next = enabledTools;
  for (const tool of BUILT_IN_TOOLS) {
    const name = tool.definition.function.name;
    if (!MODE_TOOL_NAMES.has(name)) continue;
    if (next.some((t) => t.function.name === name)) continue;
    next = [...next, tool.definition];
  }
  return next;
}

/** Expose orchestrate board_* tools to the engine loop (headless catalog strips them). */
function mergeBoardToolDefinitions(
  enabledTools: ReturnType<typeof getHeadlessToolDefinitions>,
): ReturnType<typeof getHeadlessToolDefinitions> {
  let next = enabledTools;
  for (const tool of BUILT_IN_TOOLS) {
    const name = tool.definition.function.name;
    if (!BOARD_TOOL_NAMES.has(name)) continue;
    if (next.some((t) => t.function.name === name)) continue;
    next = [...next, tool.definition];
  }
  return next;
}

/** Expose spawn/cancel/list/status sub-agent tools (headless catalog strips them). */
function mergeSubAgentToolDefinitions(
  enabledTools: ReturnType<typeof getHeadlessToolDefinitions>,
): ReturnType<typeof getHeadlessToolDefinitions> {
  let next = enabledTools;
  for (const tool of BUILT_IN_TOOLS) {
    const name = tool.definition.function.name;
    if (!SUB_AGENT_TOOL_NAMES.has(name)) continue;
    if (next.some((t) => t.function.name === name)) continue;
    next = [...next, tool.definition];
  }
  return next;
}

/**
 * Run board_* tools against the engine-hosted sessionState alias, then publish.
 * Rebinds synchronously so mutateEngineState clones cannot leave board_init on a stale blob.
 */
async function executeEngineBoardTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
): Promise<{ content: string }> {
  const { activateEngineBoardHost } = await import('./board-host.ts');
  await activateEngineBoardHost();
  const { getEngineSessionState, publishLiveEngineState } = await import(
    '../../server/session/engine-api.js'
  );
  const { setSessionStateForEngineHost } = await import('../state/sessions.ts');
  const live = getEngineSessionState();
  if (live) setSessionStateForEngineHost(live as import('../types').SessionState);

  const { executeBoardTool, setBoardExecutorContext } = await import(
    '../tools/board-tools.ts'
  );
  setBoardExecutorContext({ chatId });
  try {
    const content = await executeBoardTool(name, args, { chatId });
    // Persist board mutations so SSE clients see init/update immediately.
    await publishLiveEngineState({ soft: false });
    return { content };
  } finally {
    setBoardExecutorContext(null);
  }
}

/**
 * Run spawn/cancel/list/status against the engine-owned controller registry.
 */
async function executeEngineSubAgentTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
  modeId: ModeId,
  toolCallId?: string,
): Promise<{ content: string }> {
  const { activateEngineControllerHost } = await import('./controller-host.ts');
  await activateEngineControllerHost();

  const { executeSubAgentTool, setSubAgentExecutorContext } = await import(
    '../tools/sub-agent-executor.ts'
  );
  setSubAgentExecutorContext({
    parentChatId: chatId,
    // Parent turn id is minted by the renderer tool loop; engine uses chat scope.
    parentTurnId: '',
    parentToolCallId: toolCallId,
    modeId,
  });
  try {
    const content = await executeSubAgentTool(name, args);
    return { content };
  } finally {
    setSubAgentExecutorContext(null);
  }
}

/** Run the persistent main-chat tool loop until final prose, abort, or error. */
export async function runEngineMainChatTurn(
  options: EngineMainChatTurnOptions,
): Promise<void> {
  const deps = options.deps ?? (await defaultDeps());
  const baseUrl = deps.baseUrl ?? 'http://127.0.0.1:9473';
  const token = deps.token ?? resolveHeadlessToken();
  installHeadlessFetch(baseUrl, token);

  await detectConfigServer();
  await detectLocalServer();
  await ensureToolConfigReady();

  const chat = await deps.getChat(options.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${options.chatId}`);
  }

  const provider = await getActiveProvider(options.providerId ?? chat.providerId);
  const sendModelId = (options.modelId?.trim() || chat.modelId?.trim() || '').trim();
  if (!sendModelId) {
    throw new Error('No model configured for engine send_message');
  }

  const systemPrompt =
    options.systemPrompt?.trim() ||
    'You are Minnow, a helpful local AI coding assistant.';
  const temperature =
    typeof options.temperature === 'number' && Number.isFinite(options.temperature)
      ? options.temperature
      : 0.7;
  const maxTokens =
    typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens)
      ? options.maxTokens
      : 4096;

  const modeId = normalizeModeId(chat.modeId) as ModeId;
  // Mode + board + sub-agent tools (stripped from headless catalog; host runs in-process).
  const enabledTools = mergeSubAgentToolDefinitions(
    mergeBoardToolDefinitions(
      mergeModeToolDefinitions(getHeadlessToolDefinitions(modeId)),
    ),
  );

  try {
    for (;;) {
      if (options.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Steer at tool-loop boundary (parity with loop.ts consumePendingSteer).
      await deps.mutateChat(options.chatId, (c) => {
        consumePendingSteerEngine(c);
      });

      const latest = await deps.getChat(options.chatId);
      if (!latest) throw new Error(`Chat not found: ${options.chatId}`);

      const messages = buildHeadlessApiMessages(latest, systemPrompt);
      const body = applySamplerToBody(
        {
          model: sendModelId,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          tools: enabledTools.length > 0 ? enabledTools : undefined,
          tool_choice: enabledTools.length > 0 ? ('auto' as const) : undefined,
        },
        { temperature },
        maxTokens,
      );

      const turnResult = await streamEngineTurn(
        provider.id,
        body as unknown as Record<string, unknown>,
        options.chatId,
        options.signal,
        async (generationId) => {
          await deps.mutateChat(
            options.chatId,
            (c) => {
              c.currentGenerationId = generationId;
              c.modelId = sendModelId;
              c.providerId = provider.id;
              c.engineTurnActive = true;
            },
            { soft: true },
          );
        },
      );

      if (turnResult.toolCalls.length === 0) {
        await deps.mutateChat(options.chatId, (c) => {
          c.history.push({
            role: 'assistant',
            content: turnResult.fullText.trim(),
          });
          c.currentGenerationId = undefined;
          c.engineTurnActive = false;
        });
        break;
      }

      await deps.mutateChat(options.chatId, (c) => {
        c.history.push({
          role: 'assistant',
          content: turnResult.fullText || null,
          tool_calls: turnResult.toolCalls,
        });
      });

      const outcomes = await runHeadlessToolBatch({
        toolCalls: turnResult.toolCalls,
        signal: options.signal,
        execute: async (name, args) => {
          if (name === 'create_chat_with_mode') {
            if (!deps.mutateSession) {
              return { content: 'Error: session mutate unavailable' };
            }
            let content = '';
            await deps.mutateSession((state) => {
              content = executeCreateChatWithModeEngine(
                (args ?? {}) as Record<string, unknown>,
                state,
                options.chatId,
              );
            });
            return { content };
          }
          if (isEngineModeTool(name)) {
            let content = '';
            await deps.mutateChat(options.chatId, (c) => {
              content = executeEngineModeTool(
                name,
                (args ?? {}) as Record<string, unknown>,
                c,
              );
            });
            return { content };
          }
          // board_init / board_* — in-process against engine SessionState (MIN-360).
          if (BOARD_TOOL_NAMES.has(name)) {
            return executeEngineBoardTool(
              name,
              (args ?? {}) as Record<string, unknown>,
              options.chatId,
            );
          }
          // spawn/cancel/list/status — engine-owned controller registry (MIN-361).
          if (SUB_AGENT_TOOL_NAMES.has(name)) {
            return executeEngineSubAgentTool(
              name,
              (args ?? {}) as Record<string, unknown>,
              options.chatId,
              modeId,
            );
          }
          return executeHeadlessTool(
            name,
            args as Record<string, unknown>,
            {
              modeId,
              chatId: options.chatId,
            },
            { noApproval: true, modeId, autoRejectQuestions: true },
          );
        },
      });

      await deps.mutateChat(options.chatId, (c) => {
        for (const outcome of outcomes) {
          const tc = outcome.toolCall;
          const content = outcome.parseError ?? outcome.result?.content ?? '';
          c.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content,
          });
        }
        c.currentGenerationId = undefined;
      });
    }

    const settled = await deps.getChat(options.chatId);
    if (!settled) return;

    if (deps.onGoalAfterTurn) {
      await deps.onGoalAfterTurn(settled, options.goalDriven === true);
    }

    const queued = peekOldestQueuedMessage(settled);
    if (queued && deps.onFlushQueue) {
      let text: string | null = null;
      await deps.mutateChat(options.chatId, (c) => {
        text = shiftOldestQueuedMessage(c);
      });
      if (text) await deps.onFlushQueue(options.chatId, text);
    }
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || options.signal.aborted);
    await deps.mutateChat(options.chatId, (c) => {
      c.currentGenerationId = undefined;
      c.engineTurnActive = false;
      if (!isAbort) {
        const message = err instanceof Error ? err.message : String(err);
        c.history.push({ role: 'assistant', content: `Error: ${message}` });
      }
    });
    if (!isAbort) throw err;
  }
}
