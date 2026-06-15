/**
 * Human-readable summaries for scheduler run history rows.
 */

import type { SchedulerRun } from './client';

function truncateText(text: string, max = 96): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Parse headless JSON captured in run.output. */
export function parseSchedulerRunOutput(
  output?: string,
): { assistantFinal?: string; error?: string | null } | null {
  if (!output?.trim()) return null;
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(output.slice(jsonStart)) as {
      assistantFinal?: string;
      error?: string | null;
    };
  } catch {
    return null;
  }
}

/** Summary column text for a scheduler run row. */
export function formatSchedulerRunSummary(run: SchedulerRun, max = 120): string {
  if (run.error?.trim()) return truncateText(run.error, max);
  const parsed = parseSchedulerRunOutput(run.output);
  if (parsed?.assistantFinal?.trim()) {
    return truncateText(parsed.assistantFinal, max);
  }
  if (parsed?.error?.trim()) {
    return truncateText(parsed.error, max);
  }
  if (run.output?.trim()) return truncateText(run.output, max);
  return '—';
}

/** Resolve the session chat id linked to a run (explicit field or JSON fallback). */
export function resolveSchedulerRunChatId(run: SchedulerRun): string | null {
  const direct = run.chatId?.trim();
  if (direct) return direct;
  const parsed = parseSchedulerRunOutput(run.output) as { chatId?: string | null } | null;
  const fromOutput = parsed?.chatId?.trim();
  return fromOutput || null;
}
