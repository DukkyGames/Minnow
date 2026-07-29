/**
 * Chat UI + history wiring for bounded parallel tool batch execution.
 * Shared by the main tool loop and incomplete-tool resume.
 */

import { patchMainTurnActivity } from '../chat/main-turn-activity.ts';
import { notifyChatStreamActivity } from '../chat/streaming-state.ts';
import { normalizeModeId } from '../chat/modes/types.ts';
import {
  logBoardTerminalRun,
  logBoardToolCall,
} from '../state/orchestrate-board-store.ts';
import {
  boardWorktreesRootsFromState,
  resolveChatToolWorkspaceRoot,
} from '../state/worktree-isolation.ts';
import {
  recordChatMessage,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions.ts';
import type { Chat, ToolCall, TurnRunId } from '../types.ts';
import { getActiveChatMountElement } from '../ui/chat-mount.ts';
import { scrollChatIfPinned } from '../ui/chat-scroll.ts';
import { attachShellKillUi } from '../ui/shell-run-ui.ts';
import type { ThoughtBubbleController } from '../ui/thought-bubbles.ts';
import { renderToolCall, renderToolResult } from '../ui/tool-messages.ts';
import { assertUiDesignerToolAllowed } from '../agents/ui-designer/tools.ts';
import type { UiDesignerMode } from '../agents/ui-designer/constants.ts';
import { setBugBoardExecutorContext } from './bug-board-tools.ts';
import { setBoardExecutorContext } from './board-tools.ts';
import { executeTool, type ExecuteToolContext } from './client.ts';
import {
  executeToolCallBatch,
  type ToolCallOutcome,
} from './execute-tool-batch.ts';
import { parallelToolsActivityLabel } from './parallel-tool-policy.ts';
import { parseToolArguments } from './parse-tool-arguments.ts';
import { setSubAgentExecutorContext } from './sub-agent-executor.ts';
import {
  refreshActiveBoardIfMounted,
} from '../ui/orchestrate-board.ts';
import {
  isOrchestrateBoardInitSplitActive,
  isOrchestrateInitSplitChromeActive,
  syncOrchestrateInitSplitChrome,
} from '../ui/orchestrate-board-init-split.ts';
import { isOrchestrateBoardViewActive } from '../ui/view-mode-toggle.ts';
import { renderSidebar } from '../ui/sidebar.ts';
import { notifyMemorySavedFromTool } from '../ui/memory-saved-toast.ts';

/** Parse exit code from execute_command formatted output. */
function parseTerminalExitCode(content: string): number | undefined {
  const match = content.match(/\(exit (-?\d+)\)/);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : undefined;
}

/** Log board-task tool/terminal activity when the chat is linked to a board task. */
function maybeLogBoardToolExecution(
  chat: Chat,
  toolName: string,
  args: unknown,
  content: string,
): void {
  const boardTaskId = chat.boardTaskId?.trim();
  const boardGroupId = chat.boardGroupId?.trim();
  if (!boardTaskId || !boardGroupId || !sessionState) {
    return;
  }
  const group = sessionState.groups?.find((g) => g.id === boardGroupId);
  if (!group?.orchestrateBoard) {
    return;
  }

  const argsPreview =
    args && typeof args === 'object' ? JSON.stringify(args) : String(args ?? '');
  const errored = content.trimStart().startsWith('Error');

  if (toolName === 'execute_command') {
    const command =
      args && typeof args === 'object' && !Array.isArray(args)
        ? String((args as Record<string, unknown>).command ?? '')
        : '';
    logBoardTerminalRun(
      group,
      boardTaskId,
      command || toolName,
      parseTerminalExitCode(content),
      content,
      errored,
      chat.id,
    );
    return;
  }

  logBoardToolCall(
    group,
    boardTaskId,
    toolName,
    argsPreview,
    content,
    errored,
    chat.id,
  );
}

export interface RunChatToolBatchOptions {
  chat: Chat;
  toolCalls: ToolCall[];
  signal: AbortSignal;
  constrained: boolean;
  paintInChat: boolean;
  parentTurnId: string;
  turnRunId?: TurnRunId;
  uiDesignerActive: boolean;
  uiDesignerMode: UiDesignerMode;
  livePartialText: string;
  thoughtController: ThoughtBubbleController | null;
  syncContextUsage: (pendingToolCallsJson?: string) => void;
  trackHistoryPush: () => void;
  /** Resume path: reuse existing `.tool-call-msg` rows when present. */
  ensureToolWrap?: (
    toolName: string,
    args: unknown,
    toolCallId: string,
  ) => HTMLElement;
}

function buildChatToolExecuteContext(
  chat: Chat,
  toolCallId: string,
  toolLoopModeId: ReturnType<typeof normalizeModeId>,
): ExecuteToolContext {
  const scopedWorkspaceRoot = resolveChatToolWorkspaceRoot(chat, sessionState?.groups);
  const boardWorktreeRoots = boardWorktreesRootsFromState(sessionState?.groups);
  return {
    chatId: chat.id,
    toolCallId,
    modeId: toolLoopModeId,
    workAgentId: chat.workAgentId ?? null,
    ...(scopedWorkspaceRoot ? { workspaceRoot: scopedWorkspaceRoot } : {}),
    ...(boardWorktreeRoots.length ? { extraPathRoots: boardWorktreeRoots } : {}),
  };
}

function applyToolOutcome(
  options: RunChatToolBatchOptions,
  outcome: ToolCallOutcome,
  toolWrap: HTMLElement,
  args: unknown,
): void {
  const { chat } = options;
  const tc = outcome.toolCall;
  const toolName = tc.function.name;
  const toolArgsRecord =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : undefined;

  if (outcome.parseError) {
    renderToolResult(toolWrap, outcome.parseError);
    chat.history.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: outcome.parseError,
    });
    options.trackHistoryPush();
    options.syncContextUsage();
    recordChatMessage(chat);
    scheduleSaveSessions();
    return;
  }

  const toolOut = outcome.result ?? { content: '' };
  const toolContent = toolOut.content;

  renderToolResult(
    toolWrap,
    toolContent,
    toolOut.attachments,
    args,
    toolOut.codeChange,
  );
  attachShellKillUi(
    toolWrap,
    toolName,
    tc.id,
    toolArgsRecord,
    toolContent,
    chat.id,
  );

  chat.history.push({
    role: 'tool',
    tool_call_id: tc.id,
    content: toolContent,
    ...(toolOut.attachments?.length ? { attachments: toolOut.attachments } : {}),
    ...(toolOut.codeChange ? { codeChange: toolOut.codeChange } : {}),
  });
  maybeLogBoardToolExecution(chat, toolName, args, toolContent);
  notifyMemorySavedFromTool(toolName, args, toolContent);
  options.trackHistoryPush();
  options.syncContextUsage();

  if (options.paintInChat) {
    scrollChatIfPinned();
  }

  if (toolName === 'board_init') {
    syncOrchestrateInitSplitChrome(chat);
  }
}

/**
 * Pre-render tool rows, run the batch executor, append tool history, and refresh board chrome.
 */
export async function runChatToolBatch(
  options: RunChatToolBatchOptions,
): Promise<void> {
  const {
    chat,
    toolCalls,
    signal,
    constrained,
    paintInChat,
    parentTurnId,
    uiDesignerActive,
    uiDesignerMode,
  } = options;

  const toolLoopModeId = normalizeModeId(chat.modeId);
  const wrapById = new Map<string, HTMLElement>();
  const argsById = new Map<string, unknown>();
  const area = getActiveChatMountElement();

  patchMainTurnActivity(chat.id, { phase: 'tools' });
  notifyChatStreamActivity(chat.id);

  for (const tc of toolCalls) {
    const { args } = parseToolArguments(tc.function.arguments, { constrained });
    argsById.set(tc.id, args);

    const toolWrap = options.ensureToolWrap
      ? options.ensureToolWrap(tc.function.name, args, tc.id)
      : (() => {
          const wrap = renderToolCall(tc.function.name, args);
          wrap.dataset.toolCallId = tc.id;
          return wrap;
        })();

    wrapById.set(tc.id, toolWrap);

    const toolArgsRecord =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : undefined;
    attachShellKillUi(
      toolWrap,
      tc.function.name,
      tc.id,
      toolArgsRecord,
      undefined,
      chat.id,
    );

    if (paintInChat && !options.ensureToolWrap) {
      area.appendChild(toolWrap);
    }
  }

  if (paintInChat) {
    scrollChatIfPinned();
  }

  let parallelAggregateLabel: string | null = null;

  await executeToolCallBatch({
    toolCalls,
    constrained,
    signal,
    onParallelSegmentStart: (calls) => {
      if (calls.length > 1) {
        parallelAggregateLabel = parallelToolsActivityLabel(calls.length);
        patchMainTurnActivity(chat.id, {
          phase: 'tools',
          currentTool: parallelAggregateLabel,
        });
        notifyChatStreamActivity(chat.id);
      } else {
        parallelAggregateLabel = null;
      }
    },
    onToolStart: (tc) => {
      notifyChatStreamActivity(chat.id);
      if (!parallelAggregateLabel) {
        patchMainTurnActivity(chat.id, {
          phase: 'tools',
          currentTool: tc.function.name,
        });
      }
    },
    execute: async (toolName, args, ctx) => {
      const planBlock = uiDesignerActive
        ? assertUiDesignerToolAllowed(toolName, uiDesignerMode)
        : null;
      if (planBlock) {
        return { content: planBlock };
      }

      setSubAgentExecutorContext({
        parentTurnId,
        modeId: toolLoopModeId,
        parentChatId: chat.id,
        parentToolCallId: ctx.toolCallId,
      });
      setBoardExecutorContext({ chatId: chat.id });
      setBugBoardExecutorContext({ chatId: chat.id });

      return executeTool(
        toolName,
        args as Record<string, unknown>,
        buildChatToolExecuteContext(chat, ctx.toolCallId, toolLoopModeId),
      );
    },
    onToolDone: (outcome) => {
      const toolWrap = wrapById.get(outcome.toolCall.id);
      if (!toolWrap) {
        return;
      }
      applyToolOutcome(options, outcome, toolWrap, argsById.get(outcome.toolCall.id));
    },
  });

  recordChatMessage(chat);
  scheduleSaveSessions();
  renderSidebar();

  if (
    isOrchestrateBoardViewActive() ||
    isOrchestrateBoardInitSplitActive(chat) ||
    isOrchestrateInitSplitChromeActive()
  ) {
    refreshActiveBoardIfMounted();
  }

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
