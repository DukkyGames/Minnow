/**
 * Boot- and chat-switch resume for tool batches interrupted by reload (e.g. open ask_question).
 */

import { beginChatTurnSetup, endChatTurnSetup, isChatTurnSetupPending } from './chat-turn-guard';
import { findIncompleteToolBatchAtTail } from './incomplete-tool-batch';
import { isChatStreaming, isStreamDomVisible } from './streaming-state';
import { createSubAgentRunId } from '../agents/sub-agent-run-id';
import { normalizeModeId } from './modes/types';
import { maybePromoteToolResultToArtifact } from './reef/artifact-promotion';
import { getActiveChat, recordChatMessage, scheduleSaveSessions, sessionState } from '../state/sessions';
import {
  boardWorktreesRootsFromState,
  resolveChatToolWorkspaceRoot,
} from '../state/worktree-isolation';
import { setBugBoardExecutorContext } from '../tools/bug-board-tools';
import { setBoardExecutorContext } from '../tools/board-tools';
import { executeTool } from '../tools/client';
import { parseToolArguments } from '../tools/parse-tool-arguments';
import { setSubAgentExecutorContext } from '../tools/sub-agent-executor';
import type { Chat } from '../types';
import { getActiveChatMountElement } from '../ui/chat-mount';
import { scrollChatIfPinned } from '../ui/chat-scroll';
import { renderToolCall, renderToolResult } from '../ui/tool-messages';
import { attachShellKillUi } from '../ui/shell-run-ui';
import { isUserPromptLocked } from '../ui/user-prompt-lock';
import { setStatus } from '../ui/status';

const resumingChatIds = new Set<string>();

function getSelectedModelIdFromDom(): string {
  const el = document.getElementById('modelSelect') as HTMLSelectElement | null;
  return el?.value?.trim() ?? '';
}

function findToolWrap(toolCallId: string): HTMLElement | null {
  return document.querySelector(
    `.tool-call-msg[data-tool-call-id="${CSS.escape(toolCallId)}"]`,
  );
}

function ensureToolWrap(
  chat: Chat,
  toolName: string,
  args: unknown,
  toolCallId: string,
): HTMLElement {
  const existing = findToolWrap(toolCallId);
  if (existing) {
    return existing;
  }
  const toolWrap = renderToolCall(toolName, args);
  toolWrap.dataset.toolCallId = toolCallId;
  if (isStreamDomVisible(chat.id)) {
    getActiveChatMountElement().appendChild(toolWrap);
  }
  return toolWrap;
}

/**
 * Re-run pending tools from the tail assistant row, then continue the chat turn.
 * Returns true when a batch was found and resume started.
 */
export async function resumeIncompleteToolBatch(
  chat: Chat,
  options: { ownsGlobalStreaming?: boolean } = {},
): Promise<boolean> {
  if (typeof document === 'undefined') {
    return false;
  }
  if (isChatStreaming(chat.id) || isChatTurnSetupPending(chat.id)) {
    return false;
  }
  if (isUserPromptLocked()) {
    return false;
  }
  if (resumingChatIds.has(chat.id)) {
    return false;
  }

  const batch = findIncompleteToolBatchAtTail(chat);
  if (!batch) {
    return false;
  }

  if (!beginChatTurnSetup(chat.id)) {
    return false;
  }

  resumingChatIds.add(chat.id);
  const parentTurnId = createSubAgentRunId();
  const toolLoopModeId = normalizeModeId(chat.modeId);

  try {
    for (const tc of batch.pendingToolCalls) {
      const { args, parseError } = parseToolArguments(tc.function.arguments, {
        constrained: false,
      });
      const toolArgsRecord =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : undefined;

      const toolWrap = ensureToolWrap(chat, tc.function.name, args, tc.id);
      attachShellKillUi(
        toolWrap,
        tc.function.name,
        tc.id,
        toolArgsRecord,
        undefined,
        chat.id,
      );

      if (parseError) {
        renderToolResult(toolWrap, parseError);
        chat.history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: parseError,
        });
        recordChatMessage(chat);
        scheduleSaveSessions();
        continue;
      }

      setSubAgentExecutorContext({
        parentTurnId,
        modeId: toolLoopModeId,
        parentChatId: chat.id,
        parentToolCallId: tc.id,
      });
      setBoardExecutorContext({ chatId: chat.id });
      setBugBoardExecutorContext({ chatId: chat.id });

      const scopedWorkspaceRoot = resolveChatToolWorkspaceRoot(chat, sessionState?.groups);
      const boardWorktreeRoots = boardWorktreesRootsFromState(sessionState?.groups);
      const toolOut = await executeTool(tc.function.name, args, {
        chatId: chat.id,
        toolCallId: tc.id,
        modeId: toolLoopModeId,
        workAgentId: chat.workAgentId ?? null,
        ...(scopedWorkspaceRoot ? { workspaceRoot: scopedWorkspaceRoot } : {}),
        ...(boardWorktreeRoots.length ? { extraPathRoots: boardWorktreeRoots } : {}),
      });

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
        /* Promotion is best-effort. */
      }

      renderToolResult(
        toolWrap,
        toolContent,
        toolOut.attachments,
        args,
        toolOut.codeChange,
      );
      attachShellKillUi(
        toolWrap,
        tc.function.name,
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
      recordChatMessage(chat);
      scheduleSaveSessions();
      if (isStreamDomVisible(chat.id)) {
        scrollChatIfPinned();
      }
    }

    endChatTurnSetup(chat.id);

    const modelId = getSelectedModelIdFromDom();
    if (!modelId) {
      setStatus('err', 'Select a model to continue this reply');
      return true;
    }

    const { runChatTurn } = await import('../tools/loop');
    await runChatTurn({
      chat,
      pushUser: false,
      rawText: '',
      userText: '',
      skillId: null,
      displayText: '',
      historyContent: '',
      validAttachments: [],
      ownsGlobalStreaming: options.ownsGlobalStreaming ?? true,
    });
    return true;
  } catch {
    endChatTurnSetup(chat.id);
    return false;
  } finally {
    resumingChatIds.delete(chat.id);
  }
}

/** Resume pending tools for the active chat after reload (other chats wait until opened). */
export async function bootIncompleteToolResumeForChats(chats: readonly Chat[]): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  const active = getActiveChat();
  if (!findIncompleteToolBatchAtTail(active)) {
    return;
  }
  await resumeIncompleteToolBatch(active, { ownsGlobalStreaming: true });
}

/** Resume when switching to a chat that still has unanswered question cards in history. */
export async function resumeIncompleteToolBatchOnChatSwitch(chat: Chat): Promise<void> {
  if (!findIncompleteToolBatchAtTail(chat)) {
    return;
  }
  await resumeIncompleteToolBatch(chat, { ownsGlobalStreaming: true });
}
