/**
 * Recover the latest orchestrate plan path from chat history (save_file under documentation/plans/).
 */

import { normalizeOrchestratePlanPath } from './plan-path.ts';
import type {
  AssistantToolCallMessage,
  Message,
  ToolCall,
  ToolResultMessage,
} from '../../types.ts';

const SAVE_FILE_TOOL = 'save_file';

/** Matches server save_file success text: `Saved documentation/plans/foo.md (123 bytes)`. */
const SAVED_PATH_RE =
  /^Saved\s+(\S+\.md)(?:\s+\(\d+\s+bytes\))?/i;

function isAssistantWithTools(msg: Message): msg is AssistantToolCallMessage {
  return (
    msg.role === 'assistant' &&
    'tool_calls' in msg &&
    Array.isArray(msg.tool_calls) &&
    msg.tool_calls.length > 0
  );
}

/** Walk backward from a tool row to its parent assistant tool_calls message. */
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

function parseToolArgs(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function pathFromSaveFileArgs(argumentsJson: string): string | undefined {
  const args = parseToolArgs(argumentsJson);
  const path = args.path;
  return typeof path === 'string' ? path : undefined;
}

function pathFromToolResultContent(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;

  const savedMatch = trimmed.match(SAVED_PATH_RE);
  if (savedMatch?.[1]) return savedMatch[1];

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        for (const key of ['path', 'file', 'filePath', 'file_path']) {
          const value = record[key];
          if (typeof value === 'string' && value.trim()) return value;
        }
      }
    } catch {
      /* fall through to plain path */
    }
  }

  if (!/\s/.test(trimmed) && /\.md$/i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

function toolCallForResult(
  assistant: AssistantToolCallMessage,
  toolRow: ToolResultMessage,
): ToolCall | undefined {
  return assistant.tool_calls.find((tc) => tc.id === toolRow.tool_call_id);
}

function normalizedPlanPathFromSaveFile(
  argsJson: string,
  resultContent: string,
): string | undefined {
  const fromArgs = pathFromSaveFileArgs(argsJson);
  const fromResult = pathFromToolResultContent(resultContent);
  const raw = fromArgs ?? fromResult;
  return raw ? normalizeOrchestratePlanPath(raw) : undefined;
}

/**
 * Latest workspace-relative plan path written via save_file to documentation/plans/*.md.
 * Scans history newest-first; correlates tool rows with preceding assistant tool_calls.
 */
export function findLastPlanSavePath(history: Message[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (msg.role !== 'tool') continue;

    const toolRow = msg as ToolResultMessage;
    const parentIndex = resolveParentAssistantIndex(history, i);
    if (parentIndex < 0) continue;

    const assistant = history[parentIndex];
    if (!assistant || !isAssistantWithTools(assistant)) continue;

    const toolCall = toolCallForResult(assistant, toolRow);
    if (!toolCall || toolCall.function?.name !== SAVE_FILE_TOOL) continue;

    const planPath = normalizedPlanPathFromSaveFile(
      toolCall.function.arguments ?? '{}',
      toolRow.content,
    );
    if (planPath) return planPath;
  }

  return undefined;
}
