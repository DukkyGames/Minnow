/**
 * Models → What fits — hardware card + ranked catalog.
 */

import { fetchHardware } from '../../models/hardware-client';
import { rankModels } from '../../models/fit';
import type { HardwareSnapshot, ModelFitResult } from '../../models/types';

const FIT_BADGE_CLASS: Record<string, string> = {
  perfect: 'models-fit-badge--perfect',
  good: 'models-fit-badge--good',
  marginal: 'models-fit-badge--marginal',
  too_tight: 'models-fit-badge--tight',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHardwareCard(root: HTMLElement, hw: HardwareSnapshot): void {
  const card = el('div', 'models-hardware-card');
  const title = el('h3', 'models-hardware-card__title', 'Your computer');
  card.appendChild(title);

  const grid = el('div', 'models-hardware-grid');
  const rows: Array<[string, string]> = [
    ['CPU', `${hw.cpuName} (${hw.cpuCores} cores)`],
    ['RAM', `${hw.availableRamGb} GB free / ${hw.totalRamGb} GB total`],
  ];

  if (hw.gpuError) {
    rows.push(['GPU', `Driver error: ${hw.gpuError}`]);
  } else if (hw.hasGpu && hw.gpuName) {
    const vram = hw.gpuVramGb != null ? `${hw.gpuVramGb} GB` : 'unknown';
    rows.push(['GPU', `${hw.gpuName} · ${vram} · ${hw.backend}`]);
  } else {
    rows.push(['GPU', 'No discrete GPU detected']);
  }

  for (const [label, value] of rows) {
    const row = el('div', 'models-hardware-row');
    row.append(el('span', 'models-hardware-label', label), el('span', 'models-hardware-value', value));
    grid.appendChild(row);
  }

  card.appendChild(grid);

  const rescan = el('button', 'models-inline-btn', 'Rescan hardware');
  rescan.type = 'button';
  rescan.addEventListener('click', () => {
    void mountRecommendSection(true);
  });
  card.appendChild(rescan);
  root.appendChild(card);
}

function renderRecommendations(root: HTMLElement, rows: ModelFitResult[]): void {
  const list = el('div', 'models-recommend-list');
  const heading = el('h3', 'models-section-subtitle', 'What fits');
  root.appendChild(heading);

  if (!rows.length) {
    root.appendChild(el('p', 'models-muted', 'No models matched this hardware profile.'));
    return;
  }

  for (const row of rows) {
    const item = el('article', 'models-recommend-row');
    const head = el('div', 'models-recommend-row__head');
    head.append(
      el('span', 'models-recommend-name', row.name),
      el(
        'span',
        `models-fit-badge ${FIT_BADGE_CLASS[row.fit_level] ?? ''}`,
        row.fit_level.replace('_', ' '),
      ),
    );
    item.appendChild(head);

    const meta = el(
      'p',
      'models-recommend-meta',
      `${row.params_b}B · ${row.quant} · ${row.required_gb} GB · ~${row.speed_tps} tok/s · score ${row.score}`,
    );
    item.appendChild(meta);
    list.appendChild(item);
  }

  root.appendChild(list);
}

/** Build the recommend tab (hardware probe + ranked list). */
export async function mountRecommendSection(fresh = false): Promise<void> {
  const mount = document.getElementById('modelsRecommendBody');
  if (!mount) return;
  mount.replaceChildren();
  mount.appendChild(el('p', 'models-muted', 'Detecting hardware…'));

  try {
    const hardware = await fetchHardware({ fresh });
    mount.replaceChildren();
    renderHardwareCard(mount, hardware);
    const ranked = rankModels(hardware, { limit: 40 });
    renderRecommendations(mount, ranked);
  } catch (err) {
    mount.replaceChildren();
    mount.appendChild(
      el(
        'p',
        'models-error',
        err instanceof Error ? err.message : 'Hardware detection failed.',
      ),
    );
  }
}
