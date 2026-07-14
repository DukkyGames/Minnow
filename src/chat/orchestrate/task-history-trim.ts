/**
 * Trim persisted board task chat history after terminal completion to reduce RAM.
 * Collapses older tool-round bodies while keeping the last few rounds intact.
 */

import { isChatStreaming } from '../streaming-state.ts';
import type { BoardTask, Chat, Message, OrchestrateBoardState } from '../../types.ts';
import { scheduleSaveSessions } from '../../state/sessions.ts';

export const TASK_HISTORY_TRIM_MARKER = '[… trimmed after task completion]';
export const TASK_HISTORY_TOOL_BODY_MAX = 500;
export const TASK_HISTORY_KEEP_TOOL_ROUNDS = 3;

const TERMINAL_TASK_STATUSES = new Set([
  'complete',
  'failed',
  'blocked',
  'quarantined',
]);

type ToolRoundSpan = { assistantIdx: number; toolEndIdx: number };

/** True when a board task status no longer needs full in-memory tool transcripts. */
export function isTerminalBoardTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

function summarizeToolBody(content: string, max = TASK_HISTORY_TOOL_BODY_MAX): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}… ${TASK_HISTORY_TRIM_MARKER}`;
}

/** Collect assistant+tool round spans in history order. */
function collectToolRoundSpans(history: Message[]): ToolRoundSpan[] {
  const spans: ToolRoundSpan[] = [];
  let i = 0;
  while (i < history.length) {
    const msg = history[i]!;
    if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls?.length) {
      const assistantIdx = i;
      i += 1;
      let toolEndIdx = assistantIdx;
      while (i < history.length && history[i]!.role === 'tool') {
        toolEndIdx = i;
        i += 1;
      }
      spans.push({ assistantIdx, toolEndIdx });
      continue;
    }
    i += 1;
  }
  return spans;
}

/**
 * Collapse tool bodies in older rounds when the chat is not open in the UI.
 * Returns true when history was mutated.
 */
export function trimBoardTaskChatHistory(
  chat: Chat,
  activeChatId: string | null | undefined,
): boolean {
  if (!chat.boardTaskId?.trim()) return false;
  if (activeChatId && chat.id === activeChatId) return false;
  // Never trim a chat that is still streaming — transcript is live upstream context.
  if (isChatStreaming(chat.id)) return false;

  const spans = collectToolRoundSpans(chat.history);
  if (spans.length <= TASK_HISTORY_KEEP_TOOL_ROUNDS) return false;

  const trimThrough = spans.length - TASK_HISTORY_KEEP_TOOL_ROUNDS;
  let changed = false;

  for (let r = 0; r < trimThrough; r++) {
    const { assistantIdx, toolEndIdx } = spans[r]!;
    for (let j = assistantIdx; j <= toolEndIdx; j++) {
      const msg = chat.history[j]!;
      if (msg.role === 'tool') {
        const next = summarizeToolBody(msg.content);
        if (next !== msg.content) {
          chat.history[j] = { ...msg, content: next };
          changed = true;
        }
        continue;
      }
      if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls?.length) {
        let roundChanged = false;
        const tool_calls = msg.tool_calls.map((tc) => {
          const args = tc.function.arguments;
          const nextArgs = summarizeToolBody(args);
          if (nextArgs === args) return tc;
          roundChanged = true;
          return {
            ...tc,
            function: { ...tc.function, arguments: nextArgs },
          };
        });
        if (roundChanged) {
          chat.history[j] = { ...msg, tool_calls };
          changed = true;
        }
      }
    }
  }

  if (changed) scheduleSaveSessions();
  return changed;
}

/** Trim build/test/fixer chats linked to a terminal task. */
export function trimTaskRelatedChats(
  task: BoardTask,
  activeChatId: string | null | undefined,
  findChatById: (id: string) => Chat | undefined,
): void {
  for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
    const id = chatId?.trim();
    if (!id) continue;
    const chat = findChatById(id);
    if (chat) trimBoardTaskChatHistory(chat, activeChatId);
  }
}

/** Linked board-task chat ids for one task row (build, test, fixer). */
function linkedTaskChatIds(task: BoardTask): string[] {
  const ids: string[] = [];
  for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
    const id = chatId?.trim();
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Trim idle (non-streaming, non-active) board task chats across the whole board.
 * Called after each task turn ends so concurrent AFK runs do not retain full tool
 * transcripts for every completed builder/tester chat in RAM.
 */
export function trimIdleBoardTaskChats(
  board: OrchestrateBoardState,
  activeChatId: string | null | undefined,
  findChatById: (id: string) => Chat | undefined,
): number {
  let trimmed = 0;
  for (const task of board.tasks) {
    for (const chatId of linkedTaskChatIds(task)) {
      const chat = findChatById(chatId);
      if (chat && trimBoardTaskChatHistory(chat, activeChatId)) trimmed += 1;
    }
  }
  const finalChatId = board.finalTest?.chatId?.trim();
  if (finalChatId) {
    const finalChat = findChatById(finalChatId);
    if (finalChat && trimBoardTaskChatHistory(finalChat, activeChatId)) trimmed += 1;
  }
  return trimmed;
}
