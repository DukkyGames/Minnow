/**
 * Derive a short label for the orchestrator's latest tool run or message (board header).
 */

import { describeToolInvocation } from '../../tools/describe-invocation';
import type { Chat, PendingTurn, ToolCall } from '../../types';

/** Chip label length; CSS may ellipsis further in narrow headers. */
const PREVIEW_MAX = 240;

export type OrchestratorActivityKind = 'tool' | 'message' | 'thinking' | 'waiting';

export interface OrchestratorActivity {
  kind: OrchestratorActivityKind;
  /** Short label for the activity chip. */
  text: string;
  /** Full text for tooltip / aria. */
  title: string;
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

function lastToolFromCalls(toolCalls?: ToolCall[]): { name: string; label: string } | null {
  if (!toolCalls?.length) return null;
  const tc = toolCalls[toolCalls.length - 1];
  const name = tc.function?.name?.trim() ?? '';
  if (!name) return null;
  const args = parseToolArgs(tc.function.arguments ?? '{}');
  return { name, label: describeToolInvocation(name, args).title };
}

function truncatePreview(text: string, max = PREVIEW_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function activityFromPending(pending: PendingTurn): OrchestratorActivity | null {
  if (pending.phase === 'thinking') {
    return {
      kind: 'thinking',
      text: 'Thinking…',
      title: 'Orchestrator is reasoning',
    };
  }

  const tool = lastToolFromCalls(pending.toolCalls);
  if (pending.phase === 'tools' || tool) {
    const label = tool?.label ?? 'Running tools…';
    return {
      kind: 'tool',
      text: label,
      title: tool ? `Tool: ${tool.name}` : 'Executing tools',
    };
  }

  const prose = pending.content?.trim();
  if (prose) {
    return {
      kind: 'message',
      text: truncatePreview(prose),
      title: prose,
    };
  }

  return {
    kind: 'waiting',
    text: 'Generating…',
    title: 'Waiting for model output',
  };
}

/** Latest orchestrator tool or message for the board header activity chip. */
export function deriveOrchestratorLastActivity(
  chat: Chat,
  isStreaming: boolean,
): OrchestratorActivity | null {
  const pending = chat.pendingTurn;
  if (isStreaming && pending) {
    return activityFromPending(pending);
  }

  if (pending?.stopped) {
    const fromPending = activityFromPending(pending);
    if (fromPending && fromPending.kind !== 'waiting') {
      return fromPending;
    }
  }

  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role !== 'assistant') continue;

    if ('tool_calls' in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const tool = lastToolFromCalls(msg.tool_calls);
      if (tool) {
        return {
          kind: 'tool',
          text: tool.label,
          title: `Last tool: ${tool.name}`,
        };
      }
    }

    const content =
      typeof msg.content === 'string' ? msg.content.trim() : '';
    if (content) {
      return {
        kind: 'message',
        text: truncatePreview(content),
        title: content,
      };
    }
  }

  return null;
}
