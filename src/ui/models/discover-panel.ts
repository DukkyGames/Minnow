import {
  resolveDownloadRepo,
  searchHubModels,
  type DownloadJob,
  type HubSearchResult,
  type ModelDownloadFormat,
} from '../../models/api-client';
import { getModels } from '../../models/catalog';
import type { CatalogModel } from '../../models/types';
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
  formatCount,
  formatParams,
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
type ModelSource = 'catalog' | 'hub';
type HubSort = 'downloads' | 'likes' | 'lastModified';

/** Long enough that a typed word is one request, short enough to feel live. */
const HUB_DEBOUNCE_MS = 350;

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

const HUB_SORT_LABELS: Array<{ value: HubSort; label: string }> = [
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'likes', label: 'Most liked' },
  { value: 'lastModified', label: 'Recently updated' },
];

interface DiscoverFilters {
  source: ModelSource;
  search: string;
  useCase: string;
  quant: string;
  targetContext: number;
  sort: SortKey;
  fitOnly: boolean;
}

const filters: DiscoverFilters = {
  source: 'catalog',
  search: '',
  useCase: '',
  quant: '',
  targetContext: DEFAULT_CONTEXT_TOKENS,
  sort: 'score',
  fitOnly: true,
};

interface HubState {
  results: HubSearchResult[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Refetching over results already on screen — dim them, don't clear them. */
  stale: boolean;
  error: string | null;
  /** Server-supplied explanation for a deliberately empty result set. */
  reason: string | null;
  hasToken: boolean;
  format: ModelDownloadFormat;
  sort: HubSort;
  /** The query the on-screen results actually answer. */
  query: string;
}

const hub: HubState = {
  results: [],
  status: 'idle',
  stale: false,
  error: null,
  reason: null,
  hasToken: false,
  format: 'gguf',
  sort: 'downloads',
  query: '',
};

let gpuGroupIndex: number | null = null;
let bound = false;
let formatDefaulted = false;

/** The node Hub results paint into, so a resolve never rebuilds the toolbar. */
let hubListHost: HTMLElement | null = null;
/** Persistent live region. */
let hubStatusNode: HTMLElement | null = null;
let hubDebounce: number | null = null;
let hubAbort: AbortController | null = null;
/** Guards against a slow earlier request overwriting a newer one. */
let hubRequestSeq = 0;
/** Bundled catalog rows — loaded on first Discover catalog paint (keeps JSON off boot). */
let bundledCatalog: CatalogModel[] | null = null;

/** Discover full render is expensive (catalog rank); download bytes alone patch the download strip. */
const DISCOVER_DOWNLOADS_CLASS = 'models-discover-downloads';
let discoverStoreFingerprint = '';

function discoverStoreFingerprintValue(): string {
  const state = getModelsState();
  return `${state.scanning}|${state.library.length}|${state.serves.length}|${state.hardware?.backend ?? ''}`;
}

function paintDownloadCards(list: HTMLElement, jobs: DownloadJob[]): void {
  list.replaceChildren();
  for (const job of jobs) list.appendChild(downloadCard(job));
}

/** Update only the in-flight download cards without rebuilding catalog / Hub results. */
function syncDiscoverDownloads(): void {
  const host = mount();
  if (!host) return;
  const downloads = activeDownloads();
  const existing = host.querySelector(`.${DISCOVER_DOWNLOADS_CLASS}`);
  if (!downloads.length) {
    existing?.remove();
    return;
  }

  let block = existing as HTMLElement | null;
  if (!block) {
    block = el('section', `models-block ${DISCOVER_DOWNLOADS_CLASS}`);
    block.appendChild(el('h3', 'models-block__label', 'Downloading'));
    const list = el('div', 'models-loaded-list');
    block.appendChild(list);
    const hardwareStrip = host.querySelector('.models-hardware-strip');
    if (hardwareStrip?.parentElement === host) {
      hardwareStrip.insertAdjacentElement('afterend', block);
    } else {
      host.prepend(block);
    }
  }

  const list = block.querySelector('.models-loaded-list');
  if (list instanceof HTMLElement) paintDownloadCards(list, downloads);
}

function mount(): HTMLElement | null {
  return document.getElementById('modelsRecommendBody');
}

function isActive(): boolean {
  return Boolean(document.getElementById('modelsSection-recommend')?.classList.contains('is-active'));
}

/** MLX only exists as an option on Metal hardware. */
function supportsMlx(hw: HardwareSnapshot | null): boolean {
  return hw?.backend === 'metal';
}

function useCaseOptions(): Array<{ value: string; label: string }> {
  const cases = new Set<string>();
  for (const model of bundledCatalog ?? []) cases.add(inferUseCase(model));
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

/** A segmented pair, focus restored to the button the user pressed because choosing a source rebuilds the toolbar underneath it. */
function segmentedControl<T extends string>(
  ariaLabel: string,
  options: Array<{ value: T; label: string }>,
  active: T,
  onSelect: (value: T) => void,
  className: string,
): HTMLElement {
  const group = el('div', className);
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', ariaLabel);

  options.forEach((option, index) => {
    const btn = el('button', 'models-segment', option.label) as HTMLButtonElement;
    btn.type = 'button';
    btn.dataset.value = option.value;
    const isActive = option.value === active;
    btn.setAttribute('aria-pressed', String(isActive));
    if (isActive) btn.classList.add('is-active');
    btn.addEventListener('click', () => onSelect(option.value));
    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = options[(index + step + options.length) % options.length];
      if (next) onSelect(next.value);
    });
    group.appendChild(btn);
  });

  return group;
}

/** Re-focus a segment after the rebuild that its own click triggered. */
function refocusSegment(hostSelector: string, value: string): void {
  const host = mount();
  const btn = host?.querySelector<HTMLButtonElement>(
    `${hostSelector} .models-segment[data-value="${value}"]`,
  );
  btn?.focus();
}

function switchSource(next: ModelSource): void {
  if (filters.source === next) return;
  filters.source = next;
  render();
  refocusSegment('.models-source', next);
  if (next === 'hub') void runHubSearch({ immediate: true });
}

function renderSearchField(): HTMLElement {
  const isHub = filters.source === 'hub';
  const label = isHub ? 'Search Hugging Face' : 'Search the catalog';

  const searchWrap = el('div', 'models-search');
  searchWrap.appendChild(icon('search', 'models-search__icon'));
  const search = el('input', 'models-search__input') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = label;
  search.value = filters.search;
  search.setAttribute('aria-label', label);
  search.addEventListener('input', () => {
    filters.search = search.value;
    if (isHub) {
      void runHubSearch({});
      return;
    }
    render();
  });
  searchWrap.appendChild(search);
  return searchWrap;
}

function selectControl(
  ariaLabel: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (next: string) => void,
): HTMLSelectElement {
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
}

function renderCatalogControls(bar: HTMLElement): void {
  bar.append(
    selectControl('Filter by use case', useCaseOptions(), filters.useCase, (next) => {
      filters.useCase = next;
      render();
    }),
    selectControl(
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
    selectControl(
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
}

function renderHubControls(bar: HTMLElement, hw: HardwareSnapshot | null): void {
  if (supportsMlx(hw)) {
    bar.appendChild(
      segmentedControl<ModelDownloadFormat>(
        'Weights format',
        [
          { value: 'mlx', label: 'MLX' },
          { value: 'gguf', label: 'GGUF' },
        ],
        hub.format,
        (next) => {
          if (hub.format === next) return;
          hub.format = next;
          render();
          refocusSegment('.models-hub-format', next);
          void runHubSearch({ immediate: true });
        },
        'models-hub-format',
      ),
    );
  }

  bar.appendChild(
    selectControl(
      'Sort Hugging Face results',
      HUB_SORT_LABELS.map((option) => ({ value: option.value, label: option.label })),
      hub.sort,
      (next) => {
        hub.sort = next as HubSort;
        void runHubSearch({ immediate: true });
      },
    ),
  );
}

function renderToolbar(hw: HardwareSnapshot | null): HTMLElement {
  const bar = el('div', 'models-toolbar');
  bar.appendChild(
    segmentedControl<ModelSource>(
      'Result source',
      [
        { value: 'catalog', label: 'Catalog' },
        { value: 'hub', label: 'Hugging Face' },
      ],
      filters.source,
      switchSource,
      'models-source',
    ),
  );
  bar.appendChild(renderSearchField());

  if (filters.source === 'catalog') renderCatalogControls(bar);
  else renderHubControls(bar, hw);

  return bar;
}

function formatEtaMs(etaMs: number | null | undefined): string {
  if (etaMs == null || !Number.isFinite(etaMs) || etaMs < 0) return '';
  const total = Math.max(0, Math.round(etaMs / 1000));
  if (total < 60) return `${total}s left`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return secs ? `${mins}m ${secs}s left` : `${mins}m left`;
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
  } else if (job.status === 'queued') {
    state.textContent = job.interrupted ? 'Resuming' : 'Queued';
    state.appendChild(el('span', 'models-spinner'));
  } else if (job.status === 'interrupted' || job.interrupted) {
    state.textContent = pct != null ? `${pct.toFixed(1)}%` : 'Resuming';
    state.appendChild(el('span', 'models-spinner'));
  } else {
    state.textContent = pct != null ? `${pct.toFixed(1)}%` : 'Downloading';
    state.appendChild(el('span', 'models-spinner'));
  }
  const artifact = job.format === 'mlx' ? 'MLX repo' : job.filename;
  head.append(
    state,
    el('span', 'models-loaded__name', artifact ? `${job.repoId} · ${artifact}` : job.repoId),
  );

  if (job.status === 'queued' || job.status === 'running' || job.status === 'interrupted') {
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

  const eta = formatEtaMs(job.etaMs);
  const speed =
    job.bytesPerSec && job.bytesPerSec > 0 ? `${formatBytes(job.bytesPerSec)}/s` : '';
  const progressBits = [speed, eta].filter(Boolean).join(' · ');
  card.appendChild(
    el(
      'p',
      'models-loaded__meta',
      job.error ??
        `${formatBytes(job.bytesReceived)}${job.totalBytes ? ` of ${formatBytes(job.totalBytes)}` : ''}${progressBits ? ` · ${progressBits}` : ''}`,
    ),
  );

  if (job.status === 'queued' || job.status === 'running' || job.status === 'interrupted') {
    const track = el('div', 'models-progress');
    const fill = el('div', 'models-progress__fill');
    if (pct != null) fill.style.width = `${pct}%`;
    else fill.classList.add('is-indeterminate');
    track.appendChild(fill);
    card.appendChild(track);
  }
  return card;
}

function openMyModels(): void {
  void import('../models-page').then((m) => m.openModels('installed'));
}

function onDiskBadge(): HTMLElement {
  const badge = el('span', 'models-card__on-disk', 'On disk');
  badge.prepend(icon('check'));
  return badge;
}

function catalogRow(row: ModelFitResult, onDisk: Set<string>): HTMLElement {
  const entry = (bundledCatalog ?? []).find((m) => m.name === row.name) ?? null;
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
    actions.append(onDiskBadge(), textButton('Open in My Models', openMyModels));
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

function hubRow(row: HubSearchResult, onDisk: Set<string>): HTMLElement {
  const tail = row.repoId.split('/').pop() ?? row.repoId;
  const owner = row.repoId.includes('/') ? row.repoId.split('/')[0] : '';
  const downloaded = onDisk.has(row.repoId) || onDisk.has(tail);

  const item = el('article', 'models-card');

  const head = el('div', 'models-card__head');
  const name = el('div', 'models-card__name-line');
  name.appendChild(el('span', 'models-card__name', tail));
  if (owner) name.appendChild(el('span', 'models-card__owner', owner));
  head.appendChild(name);
  head.appendChild(chip(row.format === 'mlx' ? 'MLX' : 'GGUF'));
  item.appendChild(head);

  const facts = el('div', 'models-card__facts');
  if (row.paramsB) facts.appendChild(chip(formatParams(row.paramsB)));
  if (row.quant) facts.appendChild(chip(row.quant));
  if (row.sizeBytes) facts.appendChild(chip(formatBytes(row.sizeBytes)));
  if (row.toolCapable) facts.appendChild(chip('Tools'));
  const downloadsChip = chip(`${formatCount(row.downloads)} downloads`);
  downloadsChip.classList.add('models-chip--optional');
  facts.appendChild(downloadsChip);
  if (row.gated) {
    const gatedChip = chip('Gated');
    gatedChip.prepend(icon('lock'));
    facts.appendChild(gatedChip);
  }
  item.appendChild(facts);

  const actions = el('div', 'models-card__actions');
  if (downloaded) {
    actions.append(onDiskBadge(), textButton('Open in My Models', openMyModels));
  } else if (row.gated && !hub.hasToken) {
    actions.appendChild(
      textButton('Add a Hugging Face token', () => {
        void import('../models-page').then((m) => m.openModels('settings'));
      }),
    );
  } else {
    const btn = textButton(
      'Download',
      () => {
        btn.disabled = true;
        btn.textContent = 'Queued…';
        void downloadModel(row.repoId, row.quant || undefined, {
          format: row.format,
          sizeBytes: row.sizeBytes ?? undefined,
        })
          .then(() => setStatus('ok', `Downloading ${row.repoId}`))
          .catch((err: unknown) => {
            btn.disabled = false;
            btn.textContent = 'Download';
            setStatus('err', err instanceof Error ? err.message : 'Download failed');
          });
      },
      'primary',
    );
    actions.appendChild(btn);
  }
  item.appendChild(actions);
  return item;
}

/** The Hub result area for the current state. */
function hubBody(): Node {
  if (hub.status === 'loading') return skeletonRows(6);

  if (hub.status === 'error') {
    return emptyState({
      glyph: 'triangle-warning',
      title: 'Could not reach Hugging Face',
      body: hub.error ?? 'The search request failed. Check your connection and try again.',
      action: { label: 'Try again', onClick: () => void runHubSearch({ immediate: true }) },
    });
  }

  if (hub.reason) {
    return emptyState({
      glyph: 'triangle-warning',
      title: 'MLX needs Apple Silicon',
      body: hub.reason,
    });
  }

  if (!hub.results.length) {
    const formatLabel = hub.format === 'mlx' ? 'MLX' : 'GGUF';
    return emptyState({
      glyph: 'search',
      title: 'Nothing on the Hub matches',
      body: hub.query
        ? `No ${formatLabel} repo matches “${hub.query}”. Try a shorter or different term.`
        : `No ${formatLabel} repos came back from the Hub.`,
      action: hub.query
        ? {
            label: 'Clear the search',
            onClick: () => {
              filters.search = '';
              render();
              void runHubSearch({ immediate: true });
            },
          }
        : undefined,
    });
  }

  const list = el('div', 'models-card-list');
  if (hub.stale) list.classList.add('is-stale');
  const onDisk = downloadedRepos();
  for (const row of hub.results) list.appendChild(hubRow(row, onDisk));
  return list;
}

/** One line describing the current state, for the persistent live region. */
function hubStatusText(): string {
  if (hub.status === 'loading') return 'Searching Hugging Face';
  if (hub.status === 'error') return 'Hugging Face search failed';
  if (hub.reason) return 'No results available on this hardware';
  if (!hub.results.length) return 'No results from Hugging Face';
  const noun = hub.results.length === 1 ? 'result' : 'results';
  return `${hub.results.length} ${noun} from Hugging Face`;
}

/** Repaint only the Hub result list, leaving the toolbar and caret alone. */
function paintHubResults(): void {
  if (!hubListHost?.isConnected) return;
  hubListHost.replaceChildren(hubBody());
  hubListHost.setAttribute('aria-busy', String(hub.stale || hub.status === 'loading'));
  if (hubStatusNode) hubStatusNode.textContent = hubStatusText();
}

async function runHubSearch(options: { immediate?: boolean }): Promise<void> {
  if (hubDebounce != null) {
    window.clearTimeout(hubDebounce);
    hubDebounce = null;
  }

  if (!options.immediate) {
    hubDebounce = window.setTimeout(() => {
      hubDebounce = null;
      void runHubSearch({ immediate: true });
    }, HUB_DEBOUNCE_MS);
    return;
  }

  hubAbort?.abort();
  const controller = new AbortController();
  hubAbort = controller;
  const seq = ++hubRequestSeq;

  const query = filters.search.trim();
  hub.stale = hub.results.length > 0;
  hub.status = hub.results.length > 0 ? 'ready' : 'loading';
  hub.error = null;
  paintHubResults();

  try {
    const response = await searchHubModels({
      query,
      format: hub.format,
      sort: hub.sort,
      signal: controller.signal,
    });
    if (seq !== hubRequestSeq) return;
    hub.results = response.results;
    hub.reason = response.reason;
    hub.hasToken = response.hasToken;
    hub.status = 'ready';
    hub.query = query;
  } catch (err) {
    if (controller.signal.aborted || seq !== hubRequestSeq) return;
    hub.status = 'error';
    hub.error = err instanceof Error ? err.message : 'Hugging Face search failed';
  } finally {
    if (seq === hubRequestSeq) {
      hub.stale = false;
      paintHubResults();
    }
  }
}

/** Redraw Discover from store state. */
export function render(): void {
  const host = mount();
  if (!host) return;

  const state = getModelsState();
  const hw = state.hardware;

  if (!hw) {
    hubListHost = null;
    hubStatusNode = null;
    host.replaceChildren(el('p', 'models-muted', 'Measuring this machine…'), skeletonRows(5));
    return;
  }

  if (!formatDefaulted) {
    formatDefaulted = true;
    hub.format = supportsMlx(hw) ? 'mlx' : 'gguf';
  }

  if (gpuGroupIndex == null) gpuGroupIndex = defaultGpuGroupIndex(hw);
  else gpuGroupIndex = resolveGpuGroupIndexAfterRescan(hw, gpuGroupIndex);

  const fragment = document.createDocumentFragment();
  fragment.appendChild(renderHardwareStrip(hw));

  const downloads = activeDownloads();
  if (downloads.length) {
    const block = el('section', `models-block ${DISCOVER_DOWNLOADS_CLASS}`);
    block.appendChild(el('h3', 'models-block__label', 'Downloading'));
    const list = el('div', 'models-loaded-list');
    paintDownloadCards(list, downloads);
    block.appendChild(list);
    fragment.appendChild(block);
  }

  fragment.appendChild(renderToolbar(hw));

  if (filters.source === 'hub') {
    hubStatusNode = el('p', 'models-hub-status');
    hubStatusNode.setAttribute('role', 'status');
    hubStatusNode.setAttribute('aria-live', 'polite');
    hubListHost = el('div', 'models-hub-results');
    fragment.append(hubStatusNode, hubListHost);
  } else {
    hubListHost = null;
    hubStatusNode = null;
    const catalogHost = el('div', 'models-catalog-results');
    catalogHost.appendChild(skeletonRows(5));
    fragment.appendChild(catalogHost);

    const refocusSearch = isModelsSearchInputFocused();
    host.replaceChildren(fragment);
    if (refocusSearch) restoreModelsSearchInputFocus(host);

    void (async () => {
      bundledCatalog = bundledCatalog ?? (await getModels());
      const budgeted = hardwareForGpuBudget(hw, gpuGroupIndex);
      const rows = await rankModels(budgeted, {
        limit: 60,
        fitOnly: filters.fitOnly,
        search: filters.search || null,
        useCase: filters.useCase || null,
        quant: filters.quant || null,
        targetContext: filters.targetContext,
        sort: filters.sort,
      });

      catalogHost.replaceChildren();
      if (!rows.length) {
        catalogHost.appendChild(
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
              : {
                  label: 'Search Hugging Face instead',
                  onClick: () => switchSource('hub'),
                },
          }),
        );
      } else {
        const onDisk = downloadedRepos();
        const list = el('div', 'models-card-list');
        for (const row of rows) list.appendChild(catalogRow(row, onDisk));
        catalogHost.appendChild(list);
      }
      if (refocusSearch) restoreModelsSearchInputFocus(host);
    })();
    return;
  }

  const refocusSearch = isModelsSearchInputFocused();
  host.replaceChildren(fragment);
  if (filters.source === 'hub') paintHubResults();
  if (refocusSearch) restoreModelsSearchInputFocus(host);
}

/** Mount Discover (idempotent). */
export function mountDiscoverSection(): void {
  if (!bound) {
    bound = true;
    subscribeModelsStore(() => {
      if (!isActive()) return;
      syncDiscoverDownloads();
      const fp = discoverStoreFingerprintValue();
      if (fp === discoverStoreFingerprint) return;
      discoverStoreFingerprint = fp;
      render();
    });
  }
  discoverStoreFingerprint = discoverStoreFingerprintValue();
  render();
  void refreshModels();
}
