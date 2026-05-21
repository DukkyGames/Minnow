/**
 * Derive a short label for the orchestrator's latest tool run or message (board header).
 */

import { describeToolInvocation } from '../../tools/describe-invocation';
import type { Chat } from '../../types';

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

function truncatePreview(text: string, max = PREVIEW_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Latest orchestrator tool or message for the board header activity chip. */
export function deriveOrchestratorLastActivity(
  chat: Chat,
  isStreaming: boolean,
): OrchestratorActivity | null {
  if (isStreaming) {
    return {
      kind: 'waiting',
      text: 'Generating…',
      title: 'Waiting for model output',
    };
  }

  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role !== 'assistant') continue;

    if ('tool_calls' in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      const tc = msg.tool_calls[msg.tool_calls.length - 1];
      const name = tc.function?.name?.trim() ?? '';
      if (name) {
        const args = parseToolArgs(tc.function.arguments ?? '{}');
        const label = describeToolInvocation(name, args).title;
        return {
          kind: 'tool',
          text: label,
          title: `Last tool: ${name}`,
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
