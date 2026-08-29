/**
 * Loaded-model activity chip labels (MIN-647).
 *
 * Kept I/O-free so Local Server and tests share the same copy without standing
 * up the Models page.
 */

import type { ServeActivity } from './api-client';

/** `1.2k` / `917` — token counts read at a glance without a jumping column width. */
export function formatActivityTokenCount(tokens: number): string {
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/** `1 queued` / `3 queued` — omitted when the host is not backed up. */
export function formatQueuedChipLabel(queued: number): string | null {
  const n = Number.isFinite(queued) ? Math.max(0, Math.trunc(queued)) : 0;
  if (n <= 0) return null;
  return n === 1 ? '1 queued' : `${n} queued`;
}

/**
 * One chip per working slot, Ready when idle, plus queue depth when llama.cpp
 * is deferring requests. Queue wins over Ready so a backed-up host is never
 * labelled idle.
 */
export function serveActivityChipLabels(activity: ServeActivity | undefined): string[] {
  const queuedLabel = formatQueuedChipLabel(activity?.queued ?? 0);

  if (!activity?.available) {
    return queuedLabel ? [queuedLabel] : ['Ready'];
  }

  const busy = activity.slots.filter((slot) => slot.state !== 'idle');
  if (!busy.length) {
    if (queuedLabel) return [queuedLabel];
    return [activity.stale ? 'Ready · stale' : 'Ready'];
  }

  const labels = busy.map((slot) =>
    slot.state === 'prompt'
      ? `${slot.id} PP ${formatActivityTokenCount(slot.promptProcessed)} tok`
      : `${slot.id} GEN ${formatActivityTokenCount(slot.decoded)} tok`,
  );
  if (queuedLabel) labels.push(queuedLabel);
  return labels;
}
