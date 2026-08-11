/**
 * Capability matrix — campaign history (capability-matrix kind only).
 */

import type { BenchmarkCampaignSummary } from '../../benchmark/campaign-types.ts';
import { listCampaignSummaries } from '../../benchmark/campaign-persistence.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatWhen(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Summaries for capability-matrix sweeps (newest first). */
export async function loadCapabilityMatrixCampaignSummaries(): Promise<
  BenchmarkCampaignSummary[]
> {
  const all = await listCampaignSummaries();
  return all.filter((row) => row.kind === 'capability-matrix');
}

/** Render run history list into host. */
export function renderCapabilityMatrixHistory(
  host: HTMLElement,
  summaries: BenchmarkCampaignSummary[],
): void {
  host.replaceChildren();
  host.className = 'cap-matrix-history';

  if (!summaries.length) {
    const empty = el('p', 'cap-matrix-history__empty', 'No capability matrix runs yet.');
    host.appendChild(empty);
    return;
  }

  const list = el('ul', 'cap-matrix-history__list');
  list.setAttribute('role', 'list');

  for (const row of summaries) {
    const item = el('li', 'cap-matrix-history__item');
    item.setAttribute('role', 'listitem');

    const title = el('span', 'cap-matrix-history__id', row.id);
    const when = el('span', 'cap-matrix-history__when', formatWhen(row.startedAt));
    const meta = el('span', 'cap-matrix-history__meta');
    meta.textContent = `${row.status} · ${row.targetCount} model${row.targetCount === 1 ? '' : 's'}`;

    item.append(title, when, meta);
    list.appendChild(item);
  }

  host.appendChild(list);
}
