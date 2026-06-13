/**
 * Models → What fits — hardware card + ranked catalog with download actions.
 */

import { fetchHardware } from '../../models/hardware-client';
import { rankModels } from '../../models/fit';
import {
  resolveDownloadRepo,
  startModelDownload,
  subscribeDownloadProgress,
} from '../../models/api-client';
import { getModels } from '../../models/catalog';
import type { HardwareSnapshot, ModelFitResult } from '../../models/types';
import { setStatus } from '../status';

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

function catalogEntryForRow(row: ModelFitResult) {
  return getModels().find((m) => m.name === row.name) ?? null;
}

function renderHardwareCard(root: HTMLElement, hw: HardwareSnapshot): void {
  const card = el('div', 'models-hardware-card');
  card.appendChild(el('h3', 'models-hardware-card__title', 'Your computer'));

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

function attachDownloadButton(row: ModelFitResult, item: HTMLElement): void {
  const entry = catalogEntryForRow(row);
  const repoId = entry ? resolveDownloadRepo(entry) : null;
  if (!repoId) return;

  const btn = el('button', 'models-inline-btn', 'Download');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Starting…';
    void startModelDownload({ repoId, quant: row.quant })
      .then((job) => {
        setStatus('ok', `Download started: ${job.repoId}`);
        btn.textContent = 'Downloading…';
        subscribeDownloadProgress(job.id, (event) => {
          if (event.status === 'completed') {
            btn.textContent = 'Downloaded';
            setStatus('ok', `Download complete: ${job.filename}`);
          } else if (event.status === 'failed' || event.status === 'cancelled') {
            btn.textContent = 'Download';
            btn.disabled = false;
            setStatus('err', event.error || `Download ${event.status}`);
          }
        });
      })
      .catch((err) => {
        btn.disabled = false;
        btn.textContent = 'Download';
        setStatus('err', err instanceof Error ? err.message : 'Download failed');
      });
  });
  item.appendChild(btn);
}

function renderRecommendations(root: HTMLElement, rows: ModelFitResult[]): void {
  const list = el('div', 'models-recommend-list');
  root.appendChild(el('h3', 'models-section-subtitle', 'What fits'));

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

    item.appendChild(
      el(
        'p',
        'models-recommend-meta',
        `${row.params_b}B · ${row.quant} · ${row.required_gb} GB · ~${row.speed_tps} tok/s · score ${row.score}`,
      ),
    );

    attachDownloadButton(row, item);
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
    const ranked = rankModels(hardware, { limit: 40, fitOnly: true });
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
