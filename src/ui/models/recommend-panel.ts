/**
 * Models → What fits — hardware card, cached scan, ranked catalog, download/serve.
 */

import { selectProviderModel } from '../../api/models';
import { fetchHardware } from '../../models/hardware-client';
import { rankModels } from '../../models/fit';
import {
  fetchCachedModels,
  resolveDownloadRepo,
  startModelDownload,
  startModelServe,
  subscribeDownloadProgress,
  type CachedModelRow,
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

type SortKey = 'score' | 'speed' | 'quality' | 'size';

interface PanelState {
  hardware: HardwareSnapshot;
  cached: CachedModelRow[];
  gpuGroupIndex: number;
  search: string;
  useCase: string;
  quant: string;
  targetContext: number;
  sort: SortKey;
  fitOnly: boolean;
}

let panelState: PanelState | null = null;
const activeDownloads = new Map<string, () => void>();

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

/** Build a set of repo ids present on disk (HF cache, artifacts, Ollama). */
function cachedRepoSet(cached: CachedModelRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of cached) {
    set.add(row.repo_id);
    if (row.gguf_files?.length) {
      for (const g of row.gguf_files) {
        if (g.name) set.add(`${row.repo_id}#${g.name}`);
      }
    }
  }
  return set;
}

function rowIsDownloaded(row: ModelFitResult, cachedSet: Set<string>): boolean {
  const entry = catalogEntryForRow(row);
  const repoId = entry ? resolveDownloadRepo(entry) : row.name.includes('/') ? row.name : null;
  if (!repoId) return false;
  if (cachedSet.has(repoId)) return true;
  const short = repoId.split('/').pop() || '';
  for (const id of cachedSet) {
    if (id === repoId || id.endsWith(`/${short}`) || id === short) return true;
  }
  return false;
}

function artifactPathForRow(row: ModelFitResult, cached: CachedModelRow[]): string | null {
  const entry = catalogEntryForRow(row);
  const repoId = entry ? resolveDownloadRepo(entry) : null;
  if (!repoId) return null;
  const match = cached.find((c) => c.repo_id === repoId);
  if (!match?.gguf_files?.length) {
    const art = cached.find((c) => c.repo_id === repoId && c.is_gguf);
    if (art?.gguf_files?.[0]) {
      return `${art.path}/${art.gguf_files[0].rel_path}`;
    }
    return null;
  }
  const quantHint = row.quant.toUpperCase();
  const file =
    match.gguf_files.find((g) => g.quant === quantHint) ||
    match.gguf_files.find((g) => g.role === 'model') ||
    match.gguf_files[0];
  if (!file) return null;
  if (match.path.includes('huggingface') || match.path.includes('models--')) {
    return null;
  }
  return `${match.path}/${file.rel_path}`;
}

function hardwareForRanking(hw: HardwareSnapshot, gpuGroupIndex: number): HardwareSnapshot {
  if (gpuGroupIndex <= 0 || !hw.gpuGroups?.length) return hw;
  const group = hw.gpuGroups[gpuGroupIndex - 1];
  if (!group) return hw;
  return {
    ...hw,
    gpuVramGb: group.vramTotal,
    gpuCount: group.count,
    gpuName: group.name,
  };
}

function uniqueUseCases(): string[] {
  const cases = new Set<string>();
  for (const m of getModels()) {
    if (m.use_case) cases.add(m.use_case);
  }
  return [...cases].sort();
}

function renderProgressBar(bytes: number, total: number | null): HTMLElement {
  const wrap = el('div', 'models-download-progress');
  const pct = total && total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : null;
  const bar = el('div', 'models-download-progress__bar');
  bar.style.width = pct != null ? `${pct}%` : '30%';
  if (pct == null) bar.classList.add('is-indeterminate');
  wrap.appendChild(bar);
  wrap.appendChild(
    el(
      'span',
      'models-download-progress__label',
      pct != null ? `${pct}%` : 'Downloading…',
    ),
  );
  return wrap;
}

function renderHardwareCard(root: HTMLElement, hw: HardwareSnapshot, onRescan: () => void): void {
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

  if (hw.gpuGroups?.length) {
    const gpuBar = el('div', 'models-gpu-toggle');
    gpuBar.appendChild(el('span', 'models-hardware-label', 'GPU budget'));
    const ramBtn = el('button', 'models-gpu-btn', 'RAM only');
    ramBtn.type = 'button';
    ramBtn.classList.toggle('is-active', (panelState?.gpuGroupIndex ?? 0) === 0);
    ramBtn.addEventListener('click', () => {
      if (!panelState) return;
      panelState.gpuGroupIndex = 0;
      void rerenderList();
    });
    gpuBar.appendChild(ramBtn);
    hw.gpuGroups.forEach((g, i) => {
      const btn = el('button', 'models-gpu-btn', `${g.count}× ${g.name}`);
      btn.type = 'button';
      btn.classList.toggle('is-active', (panelState?.gpuGroupIndex ?? 0) === i + 1);
      btn.addEventListener('click', () => {
        if (!panelState) return;
        panelState.gpuGroupIndex = i + 1;
        void rerenderList();
      });
      gpuBar.appendChild(btn);
    });
    card.appendChild(gpuBar);
  }

  const rescan = el('button', 'models-inline-btn', 'Rescan');
  rescan.type = 'button';
  rescan.addEventListener('click', onRescan);
  card.appendChild(rescan);
  root.appendChild(card);
}

function renderFilters(root: HTMLElement): void {
  if (!panelState) return;
  const bar = el('div', 'models-filter-bar');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'models-filter-input';
  search.placeholder = 'Search models…';
  search.value = panelState.search;
  search.addEventListener('input', () => {
    if (!panelState) return;
    panelState.search = search.value;
    void rerenderList();
  });

  const useCase = document.createElement('select');
  useCase.className = 'models-filter-select';
  useCase.appendChild(el('option', '', 'All use cases'));
  for (const uc of uniqueUseCases()) {
    const opt = el('option', '', uc);
    opt.value = uc;
    if (panelState.useCase === uc) opt.selected = true;
    useCase.appendChild(opt);
  }
  useCase.addEventListener('change', () => {
    if (!panelState) return;
    panelState.useCase = useCase.value;
    void rerenderList();
  });

  const quant = document.createElement('select');
  quant.className = 'models-filter-select';
  for (const q of ['', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q3_K_M', 'Q2_K']) {
    const opt = el('option', '', q || 'Any quant');
    opt.value = q;
    if (panelState.quant === q) opt.selected = true;
    quant.appendChild(opt);
  }
  quant.addEventListener('change', () => {
    if (!panelState) return;
    panelState.quant = quant.value;
    void rerenderList();
  });

  const sort = document.createElement('select');
  sort.className = 'models-filter-select';
  for (const [val, label] of [
    ['score', 'Best fit'],
    ['speed', 'Fastest'],
    ['quality', 'Quality'],
    ['size', 'Smallest'],
  ] as const) {
    const opt = el('option', '', label);
    opt.value = val;
    if (panelState.sort === val) opt.selected = true;
    sort.appendChild(opt);
  }
  sort.addEventListener('change', () => {
    if (!panelState) return;
    panelState.sort = sort.value as SortKey;
    void rerenderList();
  });

  const ctxLabel = el('label', 'models-filter-ctx', `Context ${panelState.targetContext}`);
  const ctx = document.createElement('input');
  ctx.type = 'range';
  ctx.min = '2048';
  ctx.max = '131072';
  ctx.step = '2048';
  ctx.value = String(panelState.targetContext);
  ctx.className = 'models-filter-range';
  ctx.addEventListener('input', () => {
    if (!panelState) return;
    panelState.targetContext = Number(ctx.value);
    ctxLabel.textContent = `Context ${panelState.targetContext}`;
    void rerenderList();
  });

  const fitOnly = document.createElement('input');
  fitOnly.type = 'checkbox';
  fitOnly.checked = panelState.fitOnly;
  fitOnly.id = 'modelsFitOnly';
  fitOnly.addEventListener('change', () => {
    if (!panelState) return;
    panelState.fitOnly = fitOnly.checked;
    void rerenderList();
  });
  const fitLabel = el('label', 'models-filter-check', 'Fit only');
  fitLabel.htmlFor = 'modelsFitOnly';
  fitLabel.prepend(fitOnly);

  bar.append(search, useCase, quant, sort, ctxLabel, ctx, fitLabel);
  root.appendChild(bar);
}

function attachRowActions(
  row: ModelFitResult,
  item: HTMLElement,
  cachedSet: Set<string>,
  hw: HardwareSnapshot,
): void {
  const downloaded = rowIsDownloaded(row, cachedSet);
  const actions = el('div', 'models-installed-actions');

  if (downloaded) {
    const dot = el('span', 'models-cached-dot', 'On disk');
    dot.title = 'Model found in local cache or artifacts';
    item.querySelector('.models-recommend-row__head')?.appendChild(dot);
  }

  const entry = catalogEntryForRow(row);
  const repoId = entry ? resolveDownloadRepo(entry) : null;

  if (!downloaded && repoId) {
    const btn = el('button', 'models-inline-btn', 'Download');
    btn.type = 'button';
    const progressMount = el('div', 'models-row-progress');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Starting…';
      void startModelDownload({ repoId, quant: row.quant })
        .then((job) => {
          setStatus('ok', `Download started: ${job.repoId}`);
          btn.textContent = 'Downloading…';
          const prev = activeDownloads.get(job.id);
          prev?.();
          const unsub = subscribeDownloadProgress(job.id, (event) => {
            progressMount.replaceChildren(
              renderProgressBar(event.bytesReceived, event.totalBytes),
            );
            if (event.status === 'completed') {
              btn.textContent = 'Downloaded';
              setStatus('ok', `Download complete: ${job.repoId}`);
              void refreshCachedAndList();
            } else if (event.status === 'failed' || event.status === 'cancelled') {
              btn.textContent = 'Download';
              btn.disabled = false;
              progressMount.replaceChildren();
              setStatus('err', event.error || `Download ${event.status}`);
            }
          });
          activeDownloads.set(job.id, unsub);
        })
        .catch((err) => {
          btn.disabled = false;
          btn.textContent = 'Download';
          setStatus('err', err instanceof Error ? err.message : 'Download failed');
        });
    });
    actions.append(btn, progressMount);
  }

  if (downloaded) {
    const serveBtn = el('button', 'models-inline-btn is-primary', 'Serve');
    serveBtn.type = 'button';
    serveBtn.addEventListener('click', () => {
      const modelPath = artifactPathForRow(row, panelState?.cached ?? []);
      if (!modelPath) {
        setStatus('err', 'GGUF path not found — open Installed to serve this file.');
        return;
      }
      serveBtn.disabled = true;
      void startModelServe({
        modelPath,
        runtime: 'llama-cpp',
        modelLabel: row.name.split('/').pop() || row.name,
        profile: 'balanced',
        hardware: hw as unknown as Record<string, unknown>,
        quant: row.quant,
        paramsB: row.params_b,
        isMoe: row.is_moe,
      })
        .then(async (serve) => {
          setStatus('ok', 'Model server started.');
          const picked = await selectProviderModel(serve.providerId, serve.modelLabel);
          if (!picked) {
            setStatus('ok', 'Served — pick the model in the top bar.');
          }
        })
        .catch((err) => {
          setStatus('err', err instanceof Error ? err.message : 'Serve failed');
          serveBtn.disabled = false;
        });
    });
    actions.appendChild(serveBtn);
  }

  if (actions.childElementCount) item.appendChild(actions);
}

function renderRecommendations(root: HTMLElement, rows: ModelFitResult[], hw: HardwareSnapshot): void {
  const listHost = root.querySelector('.models-recommend-list-host');
  if (!listHost) return;
  listHost.replaceChildren();

  if (!rows.length) {
    listHost.appendChild(el('p', 'models-muted', 'No models matched this filter.'));
    return;
  }

  const cachedSet = cachedRepoSet(panelState?.cached ?? []);
  const list = el('div', 'models-recommend-list');
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
    attachRowActions(row, item, cachedSet, hw);
    list.appendChild(item);
  }
  listHost.appendChild(list);
}

async function rerenderList(): Promise<void> {
  const mount = document.getElementById('modelsRecommendBody');
  if (!mount || !panelState) return;
  const hw = hardwareForRanking(panelState.hardware, panelState.gpuGroupIndex);
  const rows = rankModels(hw, {
    limit: 60,
    fitOnly: panelState.fitOnly,
    search: panelState.search || null,
    useCase: panelState.useCase || null,
    quant: panelState.quant || null,
    targetContext: panelState.targetContext,
    sort: panelState.sort,
  });
  renderRecommendations(mount, rows, hw);
  mount.querySelectorAll('.models-gpu-btn').forEach((btn, i) => {
    btn.classList.toggle('is-active', panelState!.gpuGroupIndex === i);
  });
}

async function refreshCachedAndList(): Promise<void> {
  if (!panelState) return;
  panelState.cached = await fetchCachedModels();
  await rerenderList();
}

function renderShell(mount: HTMLElement, onRescan: () => void): void {
  if (!panelState) return;
  mount.replaceChildren();
  renderHardwareCard(mount, panelState.hardware, onRescan);
  renderFilters(mount);
  mount.appendChild(el('h3', 'models-section-subtitle', 'Ranked catalog'));
  mount.appendChild(el('div', 'models-recommend-list-host'));
  void rerenderList();
}

/** Build the recommend tab (hardware probe + ranked list + cached scan). */
export async function mountRecommendSection(fresh = false): Promise<void> {
  const mount = document.getElementById('modelsRecommendBody');
  if (!mount) return;
  mount.replaceChildren();
  mount.appendChild(el('p', 'models-muted', 'Detecting hardware and scanning local models…'));

  const rescan = () => void mountRecommendSection(true);

  try {
    const [hardware, cached] = await Promise.all([
      fetchHardware({ fresh }),
      fetchCachedModels().catch(() => [] as CachedModelRow[]),
    ]);

    panelState = {
      hardware,
      cached,
      gpuGroupIndex: 0,
      search: '',
      useCase: '',
      quant: '',
      targetContext: 8192,
      sort: 'score',
      fitOnly: true,
    };

    renderShell(mount, rescan);
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
