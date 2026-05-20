/**
 * Pure history truncation helpers (no DOM / session imports — safe for unit tests).
 */

import type {
  AssistantToolCallMessage,
  Message,
  ToolResultMessage,
} from '../types';

function isAssistantWithTools(msg: Message): msg is AssistantToolCallMessage {
  return (
    msg.role === 'assistant' &&
    'tool_calls' in msg &&
    Array.isArray((msg as AssistantToolCallMessage).tool_calls) &&
    (msg as AssistantToolCallMessage).tool_calls.length > 0
  );
}

function resolveParentAssistantIndex(history: Message[], toolIndex: number): number {
  for (let i = toolIndex - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === 'assistant' && isAssistantWithTools(row)) {
      return i;
    }
    if (row?.role === 'user') break;
  }
  return -1;
}

/** End index of tool result rows following an assistant tool_calls message. */
export function findToolResultRange(
  history: Message[],
  assistantIndex: number,
): { start: number; end: number } {
  const assistant = history[assistantIndex];
  if (!assistant || !isAssistantWithTools(assistant)) {
    return { start: assistantIndex, end: assistantIndex };
  }

  const ids = new Set(assistant.tool_calls.map((tc) => tc.id));
  let end = assistantIndex;
  for (let i = assistantIndex + 1; i < history.length; i += 1) {
    const row = history[i];
    if (row?.role !== 'tool') break;
    const toolRow = row as ToolResultMessage;
    if (!ids.has(toolRow.tool_call_id)) break;
    end = i;
  }
  return { start: assistantIndex, end };
}

/** Map any history index to the inclusive atomic block [start, end]. */
export function expandAtomicRange(
  history: Message[],
  index: number,
): { start: number; end: number } {
  if (index < 0 || index >= history.length) {
    return { start: index, end: index };
  }

  const row = history[index];
  if (row.role === 'tool') {
    const parent = resolveParentAssistantIndex(history, index);
    if (parent < 0) return { start: index, end: index };
    return findToolResultRange(history, parent);
  }

  if (isAssistantWithTools(row)) {
    return findToolResultRange(history, index);
  }

  return { start: index, end: index };
}

/** Remove incomplete tool tails so API replay stays consistent. */
export function normalizeHistoryTail(history: Message[]): void {
  while (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'tool') {
      const parent = resolveParentAssistantIndex(history, history.length - 1);
      if (parent < 0) {
        history.pop();
        continue;
      }
      const assistant = history[parent] as AssistantToolCallMessage;
      const ids = new Set(assistant.tool_calls.map((tc) => tc.id));
      const toolIds = new Set<string>();
      for (let i = parent + 1; i < history.length; i += 1) {
        const row = history[i];
        if (row.role !== 'tool') break;
        toolIds.add((row as ToolResultMessage).tool_call_id);
      }
      const complete = [...ids].every((id) => toolIds.has(id));
      if (!complete) {
        history.splice(parent);
        continue;
      }
      break;
    }

    if (isAssistantWithTools(last)) {
      const ids = new Set(last.tool_calls.map((tc) => tc.id));
      const found = new Set<string>();
      for (let j = history.length - 1; j >= 0; j -= 1) {
        if (history[j] === last) {
          for (let k = j + 1; k < history.length; k += 1) {
            if (history[k].role !== 'tool') break;
            found.add((history[k] as ToolResultMessage).tool_call_id);
          }
          break;
        }
      }
      const complete = [...ids].every((id) => found.has(id));
      if (!complete) {
        history.pop();
        continue;
      }
      break;
    }

    break;
  }
}

/** Last user message index in history, or -1. */
export function indexOfLastUserMessage(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') return i;
  }
  return -1;
}

/** User index immediately before an atomic block (for remake assistant). */
export function indexOfUserBeforeBlock(
  history: Message[],
  blockStart: number,
): number {
  for (let i = blockStart - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') return i;
  }
  return -1;
}

/** Apply inclusive/exclusive slice after atomic expansion (mutates caller-owned copy). */
export function sliceHistoryAtTurn(
  history: Message[],
  cutIndex: number,
  mode: 'inclusive' | 'exclusive',
): Message[] {
  const { start, end } = expandAtomicRange(history, cutIndex);
  const next =
    mode === 'inclusive'
      ? history.slice(0, end + 1)
      : history.slice(0, start);
  normalizeHistoryTail(next);
  return next;
}
