/**
 * Models → Discover — the catalog, ranked against the hardware Minnow measured,
 * plus the download queue.
 */

import { resolveDownloadRepo, type DownloadJob } from '../../models/api-client';
import { getModels } from '../../models/catalog';
import { DEFAULT_CONTEXT_TOKENS } from '../../models/default-context-tokens';
import {
  defaultGpuGroupIndex,
  hardwareForGpuBudget,
  rankModels,
  resolveGpuGroupIndexAfterRescan,
} from '../../models/fit';
import { inferUseCase } from '../../models/quant';
import type { HardwareSnapshot, ModelFitResult } from '../../models/types';
import { setStatus } from '../status';
import {
  chip,
  el,
  emptyState,
  formatBytes,
  icon,
  iconButton,
  isModelsSearchInputFocused,
  restoreModelsSearchInputFocus,
  skeletonRows,
  textButton,
} from './dom';
import {
  activeDownloads,
  cancelDownload,
  downloadModel,
  downloadedRepos,
  getModelsState,
  refreshHardware,
  refreshModels,
  subscribeModelsStore,
} from './store';

type SortKey = 'score' | 'speed' | 'quality' | 'size';

const FIT_VARIANT: Record<string, string> = {
  perfect: 'fit-perfect',
  good: 'fit-good',
  marginal: 'fit-marginal',
  too_tight: 'fit-tight',
};

const FIT_LABEL: Record<string, string> = {
  perfect: 'Ideal fit',
  good: 'Good fit',
  marginal: 'Tight',
  too_tight: 'Too large',
};

const USE_CASE_LABELS: Record<string, string> = {
  general: 'General purpose',
  coding: 'Code',
  reasoning: 'Reasoning',
  chat: 'Chat',
  multimodal: 'Vision',
  embedding: 'Embeddings',
  tts: 'Text to speech',
  stt: 'Speech to text',
};

interface DiscoverFilters {
  search: string;
  useCase: string;
  quant: string;
  targetContext: number;
  sort: SortKey;
  fitOnly: boolean;
}

const filters: DiscoverFilters = {
  search: '',
  useCase: '',
  quant: '',
  targetContext: DEFAULT_CONTEXT_TOKENS,
  sort: 'score',
  fitOnly: true,
};

let gpuGroupIndex: number | null = null;
let bound = false;

function mount(): HTMLElement | null {
  return document.getElementById('modelsRecommendBody');
}

function isActive(): boolean {
  return Boolean(document.getElementById('modelsSection-recommend')?.classList.contains('is-active'));
}

function useCaseOptions(): Array<{ value: string; label: string }> {
  const cases = new Set<string>();
  for (const model of getModels()) cases.add(inferUseCase(model));
  return [
    { value: '', label: 'Any use case' },
    ...[...cases].sort().map((value) => ({ value, label: USE_CASE_LABELS[value] ?? value })),
  ];
}

function renderHardwareStrip(hw: HardwareSnapshot): HTMLElement {
  const strip = el('div', 'models-hw');

  const facts = el('div', 'models-hw__facts');
  const fact = (label: string, value: string, variant?: string) => {
    const cell = el('div', 'models-hw__fact');
    cell.append(
      el('span', 'models-hw__label', label),
      el('span', `models-hw__value${variant ? ` models-hw__value--${variant}` : ''}`, value),
    );
    return cell;
  };

  if (hw.gpuError) {
    facts.appendChild(fact('GPU', hw.gpuError, 'warn'));
  } else if (hw.hasGpu && hw.gpuName) {
    facts.appendChild(
      fact('GPU', `${hw.gpuName}${hw.gpuVramGb != null ? ` · ${hw.gpuVramGb} GB` : ''}`),
    );
  } else {
    facts.appendChild(fact('GPU', 'None detected', 'warn'));
  }
  facts.append(
    fact('RAM', `${hw.availableRamGb} of ${hw.totalRamGb} GB free`),
    fact('CPU', `${hw.cpuName} · ${hw.cpuCores} cores`),
    fact('Backend', hw.backend),
  );
  strip.appendChild(facts);

  if (hw.gpuGroups?.length) {
    const budget = el('div', 'models-hw__budget');
    budget.appendChild(el('span', 'models-hw__label', 'Budget'));
    const options = [
      { label: 'RAM only', index: 0 },
      ...hw.gpuGroups.map((g, i) => ({ label: `${g.count}× ${g.name}`, index: i + 1 })),
    ];
    for (const option of options) {
      const btn = el('button', 'models-segment', option.label);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(gpuGroupIndex === option.index));
      if (gpuGroupIndex === option.index) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        gpuGroupIndex = option.index;
        render();
      });
      budget.appendChild(btn);
    }
    strip.appendChild(budget);
  }

  strip.appendChild(
    iconButton('refresh', 'Re-probe hardware', () => {
      void refreshHardware();
    }),
  );
  return strip;
}

function renderFilters(): HTMLElement {
  const bar = el('div', 'models-toolbar');

  const searchWrap = el('div', 'models-search');
  searchWrap.appendChild(icon('search', 'models-search__icon'));
  const search = el('input', 'models-search__input') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search the catalog';
  search.value = filters.search;
  search.setAttribute('aria-label', 'Search the catalog');
  search.addEventListener('input', () => {
    filters.search = search.value;
    render();
  });
  searchWrap.appendChild(search);
  bar.appendChild(searchWrap);

  const select = (
    ariaLabel: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    onChange: (next: string) => void,
  ) => {
    const node = el('select', 'models-select') as HTMLSelectElement;
    node.setAttribute('aria-label', ariaLabel);
    for (const opt of options) {
      const option = el('option', undefined, opt.label) as HTMLOptionElement;
      option.value = opt.value;
      if (opt.value === value) option.selected = true;
      node.appendChild(option);
    }
    node.addEventListener('change', () => onChange(node.value));
    return node;
  };

  bar.append(
    select('Filter by use case', useCaseOptions(), filters.useCase, (next) => {
      filters.useCase = next;
      render();
    }),
    select(
      'Filter by quantization',
      ['', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q3_K_M', 'Q2_K'].map((q) => ({
        value: q,
        label: q || 'Any quant',
      })),
      filters.quant,
      (next) => {
        filters.quant = next;
        render();
      },
    ),
    select(
      'Sort results',
      [
        { value: 'score', label: 'Best fit' },
        { value: 'speed', label: 'Fastest' },
        { value: 'quality', label: 'Highest quality' },
        { value: 'size', label: 'Smallest' },
      ],
      filters.sort,
      (next) => {
        filters.sort = next as SortKey;
        render();
      },
    ),
  );

  const ctxWrap = el('label', 'models-range');
  ctxWrap.append(el('span', 'models-range__label', 'Context'));
  const ctxValue = el('span', 'models-range__value', filters.targetContext.toLocaleString());
  const ctx = el('input', 'models-range__input') as HTMLInputElement;
  ctx.type = 'range';
  ctx.min = '2048';
  ctx.max = '262144';
  ctx.step = '1000';
  ctx.value = String(filters.targetContext);
  ctx.setAttribute('aria-label', 'Target context length');
  ctx.addEventListener('input', () => {
    filters.targetContext = Number(ctx.value);
    ctxValue.textContent = filters.targetContext.toLocaleString();
  });
  ctx.addEventListener('change', () => render());
  ctxWrap.append(ctxValue, ctx);
  bar.appendChild(ctxWrap);

  const fitWrap = el('label', 'models-check');
  const fit = el('input') as HTMLInputElement;
  fit.type = 'checkbox';
  fit.checked = filters.fitOnly;
  fit.addEventListener('change', () => {
    filters.fitOnly = fit.checked;
    render();
  });
  fitWrap.append(fit, el('span', undefined, 'Only what fits'));
  bar.appendChild(fitWrap);

  return bar;
}

function downloadCard(job: DownloadJob): HTMLElement {
  const card = el('article', 'models-loaded is-loading');
  const head = el('div', 'models-loaded__head');
  const pct =
    job.totalBytes && job.totalBytes > 0
      ? Math.min(100, (job.bytesReceived / job.totalBytes) * 100)
      : null;

  const state = el('span', 'models-loaded__state');
  if (job.status === 'failed' || job.status === 'cancelled') {
    state.classList.add('is-error');
    state.textContent = job.status === 'failed' ? 'Failed' : 'Cancelled';
  } else {
    state.textContent = pct != null ? `${pct.toFixed(1)}%` : 'Downloading';
    state.appendChild(el('span', 'models-spinner'));
  }
  head.append(state, el('span', 'models-loaded__name', `${job.repoId} · ${job.filename}`));

  if (job.status === 'queued' || job.status === 'running') {
    const actions = el('div', 'models-loaded__actions');
    actions.appendChild(
      textButton('Cancel', () => {
        void cancelDownload(job.id).catch((err: unknown) => {
          setStatus('err', err instanceof Error ? err.message : 'Cancel failed');
        });
      }),
    );
    head.appendChild(actions);
  }
  card.appendChild(head);

  card.appendChild(
    el(
      'p',
      'models-loaded__meta',
      job.error ??
        `${formatBytes(job.bytesReceived)}${job.totalBytes ? ` of ${formatBytes(job.totalBytes)}` : ''}`,
    ),
  );

  if (job.status === 'queued' || job.status === 'running') {
    const track = el('div', 'models-progress');
    const fill = el('div', 'models-progress__fill');
    if (pct != null) fill.style.width = `${pct}%`;
    else fill.classList.add('is-indeterminate');
    track.appendChild(fill);
    card.appendChild(track);
  }
  return card;
}

function catalogRow(row: ModelFitResult, onDisk: Set<string>): HTMLElement {
  const entry = getModels().find((m) => m.name === row.name) ?? null;
  const repoId = entry ? resolveDownloadRepo(entry) : row.name.includes('/') ? row.name : null;
  const tail = repoId?.split('/').pop() ?? '';
  const downloaded = Boolean(repoId && (onDisk.has(repoId) || (tail && onDisk.has(tail))));

  const item = el('article', 'models-card');

  const head = el('div', 'models-card__head');
  const name = el('div', 'models-card__name-line');
  name.append(el('span', 'models-card__name', row.name.split('/').pop() ?? row.name));
  if (row.name.includes('/')) {
    name.appendChild(el('span', 'models-card__owner', row.name.split('/')[0]));
  }
  head.appendChild(name);
  head.appendChild(chip(FIT_LABEL[row.fit_level] ?? row.fit_level, FIT_VARIANT[row.fit_level]));
  item.appendChild(head);

  const facts = el('div', 'models-card__facts');
  facts.append(
    chip(`${row.params_b}B`),
    chip(row.quant),
    chip(`${row.size_gb} GB`),
    chip(`${row.required_gb} GB needed`),
    chip(`~${row.speed_tps} tok/s`),
  );
  item.appendChild(facts);

  const actions = el('div', 'models-card__actions');
  if (downloaded) {
    const badge = el('span', 'models-card__on-disk', 'On disk');
    badge.prepend(icon('check'));
    actions.append(
      badge,
      textButton('Open in My Models', () => {
        void import('../models-page').then((m) => m.openModels('installed'));
      }),
    );
  } else if (repoId) {
    const btn = textButton(
      'Download',
      () => {
        btn.disabled = true;
        btn.textContent = 'Queued…';
        void downloadModel(repoId, row.quant)
          .then(() => setStatus('ok', `Downloading ${repoId}`))
          .catch((err: unknown) => {
            btn.disabled = false;
            btn.textContent = 'Download';
            setStatus('err', err instanceof Error ? err.message : 'Download failed');
          });
      },
      'primary',
    );
    actions.appendChild(btn);
  } else {
    actions.appendChild(el('span', 'models-muted', 'No GGUF build published'));
  }
  item.appendChild(actions);
  return item;
}

/** Redraw Discover from store state. */
export function render(): void {
  const host = mount();
  if (!host) return;

  const state = getModelsState();
  const hw = state.hardware;

  if (!hw) {
    host.replaceChildren(el('p', 'models-muted', 'Measuring this machine…'), skeletonRows(5));
    return;
  }

  if (gpuGroupIndex == null) gpuGroupIndex = defaultGpuGroupIndex(hw);
  else gpuGroupIndex = resolveGpuGroupIndexAfterRescan(hw, gpuGroupIndex);

  const budgeted = hardwareForGpuBudget(hw, gpuGroupIndex);
  const rows = rankModels(budgeted, {
    limit: 60,
    fitOnly: filters.fitOnly,
    search: filters.search || null,
    useCase: filters.useCase || null,
    quant: filters.quant || null,
    targetContext: filters.targetContext,
    sort: filters.sort,
  });

  const fragment = document.createDocumentFragment();
  fragment.appendChild(renderHardwareStrip(hw));

  const downloads = activeDownloads();
  if (downloads.length) {
    const block = el('section', 'models-block');
    block.appendChild(el('h3', 'models-block__label', 'Downloading'));
    const list = el('div', 'models-loaded-list');
    for (const job of downloads) list.appendChild(downloadCard(job));
    block.appendChild(list);
    fragment.appendChild(block);
  }

  fragment.appendChild(renderFilters());

  if (!rows.length) {
    fragment.appendChild(
      emptyState({
        glyph: 'search',
        title: 'Nothing matches',
        body: filters.fitOnly
          ? 'No catalog model fits this budget with these filters. Turn off "Only what fits" to see the rest.'
          : 'No catalog model matches these filters.',
        action: filters.fitOnly
          ? {
              label: 'Show models that do not fit',
              onClick: () => {
                filters.fitOnly = false;
                render();
              },
            }
          : undefined,
      }),
    );
  } else {
    const onDisk = downloadedRepos();
    const list = el('div', 'models-card-list');
    for (const row of rows) list.appendChild(catalogRow(row, onDisk));
    fragment.appendChild(list);
  }

  const refocusSearch = isModelsSearchInputFocused();
  host.replaceChildren(fragment);
  if (refocusSearch) restoreModelsSearchInputFocus(host);
}

/** Mount Discover (idempotent). */
export function mountDiscoverSection(): void {
  if (!bound) {
    bound = true;
    subscribeModelsStore(() => {
      if (isActive()) render();
    });
  }
  render();
  void refreshModels();
}
