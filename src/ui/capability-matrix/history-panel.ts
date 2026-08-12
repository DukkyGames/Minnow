/**
 * Capability matrix — campaign history (capability-matrix kind only).
 */

import type { BenchmarkCampaignSummary } from '../../benchmark/campaign-types.ts';
import { listCampaignSummaries } from '../../benchmark/campaign-persistence.ts';

export type CapabilityMatrixHistoryOptions = {
  /** Highlight the run currently shown in the grid. */
  selectedId?: string | null;
  /** Toggle selection when a run row is clicked. */
  onSelect?: (summary: BenchmarkCampaignSummary | null) => void;
  /** Whether a history row can be continued (cancelled with remaining work). */
  canResume?: (summary: BenchmarkCampaignSummary) => boolean;
  /** Continue a cancelled sweep from run history. */
  onContinue?: (summary: BenchmarkCampaignSummary) => void;
};

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

/** Render collapsible run history list into host. */
export function renderCapabilityMatrixHistory(
  host: HTMLElement,
  summaries: BenchmarkCampaignSummary[],
  options: CapabilityMatrixHistoryOptions = {},
): void {
  const { selectedId = null, onSelect, canResume, onContinue } = options;

  host.replaceChildren();
  host.className = 'cap-matrix-history';
  host.dataset.settingsSearchKey = 'advanced.capabilityMatrix.history';

  const toggle = el('button', 'cap-matrix-history__toggle settings-group__title');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', summaries.length ? 'false' : 'true');
  toggle.append(
    document.createTextNode('Run history'),
    el(
      'span',
      'cap-matrix-history__count',
      summaries.length ? ` (${summaries.length})` : '',
    ),
  );

  const panel = el('div', 'cap-matrix-history__panel');
  panel.hidden = summaries.length > 0;

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  if (!summaries.length) {
    panel.hidden = false;
    panel.appendChild(el('p', 'cap-matrix-history__empty', 'No matrix runs yet.'));
  } else {
    const list = el('ul', 'cap-matrix-history__list');
    list.setAttribute('role', 'list');

    for (const row of summaries) {
      const item = el('li', 'cap-matrix-history__item');
      item.setAttribute('role', 'listitem');
      item.dataset.campaignId = row.id;

      const selectBtn = el('button', 'cap-matrix-history__select');
      selectBtn.type = 'button';
      selectBtn.title = 'View probe results from this run';

      if (selectedId === row.id) {
        item.classList.add('is-selected');
        selectBtn.setAttribute('aria-pressed', 'true');
      } else {
        selectBtn.setAttribute('aria-pressed', 'false');
      }

      const title = el('span', 'cap-matrix-history__id', row.id);
      const when = el('span', 'cap-matrix-history__when', formatWhen(row.startedAt));
      const meta = el('span', 'cap-matrix-history__meta');
      meta.textContent = `${row.status} · ${row.targetCount} model${row.targetCount === 1 ? '' : 's'}`;

      selectBtn.append(title, when, meta);

      selectBtn.addEventListener('click', () => {
        if (!onSelect) return;
        onSelect(selectedId === row.id ? null : row);
      });

      item.appendChild(selectBtn);

      if (canResume?.(row) && onContinue) {
        item.classList.add('cap-matrix-history__item--resumable');
        const continueBtn = el('button', 'cap-matrix-history__continue', 'Continue');
        continueBtn.type = 'button';
        continueBtn.addEventListener('click', () => {
          onContinue(row);
        });
        item.appendChild(continueBtn);
      }

      list.appendChild(item);
    }

    panel.appendChild(list);
  }

  host.append(toggle, panel);
}
