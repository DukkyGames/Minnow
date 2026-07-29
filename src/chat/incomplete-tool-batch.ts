/**
 * Detect assistant tool_call rows at the history tail that lack matching tool results.
 * Used to restore ask_question UI and other blocking tools after reload.
 */

import type {
  AssistantToolCallMessage,
  Chat,
  Message,
  ToolCall,
  ToolResultMessage,
} from '../types';

/** Tools that block on the ask_question card UI until the user answers. */
export const USER_INPUT_BLOCKING_TOOLS = new Set([
  'ask_question',
  'propose_mode_switch',
]);

export interface IncompleteToolBatch {
  assistantHistoryIndex: number;
  /** Tool calls from the assistant row that lack tool results, in order. */
  pendingToolCalls: ToolCall[];
}

function isAssistantWithTools(msg: Message): msg is AssistantToolCallMessage {
  return (
    msg.role === 'assistant' &&
    'tool_calls' in msg &&
    Array.isArray((msg as AssistantToolCallMessage).tool_calls) &&
    (msg as AssistantToolCallMessage).tool_calls.length > 0
  );
}

/**
 * Returns the incomplete tool batch at the end of session history, or null when the
 * tail is a finished turn (prose assistant, user message, or fully answered tool_calls).
 */
export function findIncompleteToolBatchAtTail(chat: Chat): IncompleteToolBatch | null {
  const history = chat.history;
  if (history.length === 0) {
    return null;
  }

  let assistantIndex = -1;
  let assistant: AssistantToolCallMessage | null = null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (isAssistantWithTools(msg)) {
      assistantIndex = i;
      assistant = msg;
      break;
    }
    if (msg.role === 'user') {
      return null;
    }
    if (msg.role === 'assistant' && !isAssistantWithTools(msg)) {
      return null;
    }
  }

  if (!assistant || assistantIndex < 0) {
    return null;
  }

  const resultIds = new Set<string>();
  for (let i = assistantIndex + 1; i < history.length; i += 1) {
    const row = history[i];
    if (row.role !== 'tool') {
      break;
    }
    resultIds.add((row as ToolResultMessage).tool_call_id);
  }

  const pending = assistant.tool_calls.filter((tc) => !resultIds.has(tc.id));
  if (pending.length === 0) {
    return null;
  }

  const last = history[history.length - 1];
  if (last.role === 'tool') {
    return { assistantHistoryIndex: assistantIndex, pendingToolCalls: pending };
  }
  if (isAssistantWithTools(last) && last === assistant) {
    return { assistantHistoryIndex: assistantIndex, pendingToolCalls: pending };
  }

  return null;
}

/** True when the next pending tool in the tail batch needs user input (question cards). */
export function chatAwaitingUserInputTool(chat: Chat): boolean {
  // Lazy-history summaries omit message bodies; incomplete-tool detection needs full history.
  if (chat.historyLoaded === false) {
    return false;
  }
  const batch = findIncompleteToolBatchAtTail(chat);
  if (!batch?.pendingToolCalls.length) {
    return false;
  }
  return batch.pendingToolCalls.some((tc) =>
    USER_INPUT_BLOCKING_TOOLS.has(tc.function.name),
  );
}
