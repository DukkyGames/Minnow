/**
 * Models → My Models — every set of weights on this machine, in one table.
 */

import { filterLibrary, type LibraryModel, type LibrarySortKey } from '../../models/library';
import { setStatus } from '../status';
import {
  el,
  emptyState,
  formatBytes,
  formatContext,
  formatParams,
  icon,
  iconButton,
  skeletonRows,
  textButton,
} from './dom';
import { showInspectorTab } from './inspector';
import { ensureLlamaRuntimeInstalled } from './llama-install-prompt';
import {
  getModelsState,
  loadForModel,
  loadModel,
  refreshModels,
  selectModel,
  serveForModel,
  subscribeModelsStore,
  unloadServe,
} from './store';

interface LibraryFilters {
  search: string;
  format: string;
  publisher: string;
  sort: LibrarySortKey;
}

/** Data columns after the identity cell. Modifiers drive responsive hiding. */
const COLUMNS: Array<[modifier: string, value: (m: LibraryModel) => string]> = [
  ['publisher', (m) => m.publisher],
  ['params', (m) => formatParams(m.paramsB)],
  ['quant', (m) => m.quant || m.format],
  ['context', (m) => formatContext(m.contextLength)],
  ['size', (m) => formatBytes(m.sizeBytes)],
];

const COLUMN_LABELS: Record<string, string> = {
  publisher: 'Publisher',
  params: 'Params',
  quant: 'Quant',
  context: 'Context',
  size: 'Size',
};

const filters: LibraryFilters = { search: '', format: '', publisher: '', sort: 'name' };
let bound = false;
/** Keeps focus and caret in the search box across re-renders. */
let searchFocused = false;

function mount(): HTMLElement | null {
  return document.getElementById('modelsInstalledBody');
}

function totals(models: LibraryModel[]): string {
  const bytes = models.reduce((sum, m) => sum + m.sizeBytes, 0);
  const noun = models.length === 1 ? 'model' : 'models';
  return `${models.length} ${noun} · ${formatBytes(bytes)}`;
}

function uniqueValues(models: LibraryModel[], key: 'format' | 'publisher'): string[] {
  return [...new Set(models.map((m) => m[key]).filter(Boolean))].sort();
}

function selectControl(
  ariaLabel: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (next: string) => void,
): HTMLSelectElement {
  const select = el('select', 'models-select') as HTMLSelectElement;
  select.setAttribute('aria-label', ariaLabel);
  for (const opt of options) {
    const option = el('option', undefined, opt.label) as HTMLOptionElement;
    option.value = opt.value;
    if (opt.value === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function renderToolbar(all: LibraryModel[], shown: LibraryModel[]): HTMLElement {
  const bar = el('div', 'models-toolbar');

  const searchWrap = el('div', 'models-search');
  searchWrap.appendChild(icon('search', 'models-search__icon'));
  const search = el('input', 'models-search__input') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Filter by name, quant, or architecture';
  search.value = filters.search;
  search.setAttribute('aria-label', 'Filter models');
  search.addEventListener('input', () => {
    filters.search = search.value;
    render();
  });
  search.addEventListener('focus', () => {
    searchFocused = true;
  });
  search.addEventListener('blur', () => {
    searchFocused = false;
  });
  searchWrap.appendChild(search);
  bar.appendChild(searchWrap);

  bar.append(
    selectControl(
      'Filter by format',
      [
        { value: '', label: 'All formats' },
        ...uniqueValues(all, 'format').map((v) => ({ value: v, label: v })),
      ],
      filters.format,
      (next) => {
        filters.format = next;
        render();
      },
    ),
    selectControl(
      'Filter by publisher',
      [
        { value: '', label: 'All publishers' },
        ...uniqueValues(all, 'publisher').map((v) => ({ value: v, label: v })),
      ],
      filters.publisher,
      (next) => {
        filters.publisher = next;
        render();
      },
    ),
    selectControl(
      'Sort models',
      [
        { value: 'name', label: 'Name' },
        { value: 'size', label: 'Largest first' },
        { value: 'params', label: 'Most parameters' },
        { value: 'publisher', label: 'Group by publisher' },
      ],
      filters.sort,
      (next) => {
        filters.sort = next as LibrarySortKey;
        render();
      },
    ),
  );

  bar.appendChild(el('span', 'models-toolbar__count', totals(shown)));
  bar.appendChild(
    iconButton('refresh', 'Rescan local folders', () => {
      void refreshModels({ fresh: true });
    }),
  );
  return bar;
}

function startLoad(model: LibraryModel, trigger: HTMLButtonElement): void {
  trigger.disabled = true;
  void (async () => {
    try {
      if (model.source !== 'ollama' && !(await ensureLlamaRuntimeInstalled())) {
        trigger.disabled = false;
        return;
      }
      await loadModel(model);
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : 'Load failed');
      trigger.disabled = false;
    }
  })();
}

function renderRowActions(model: LibraryModel): HTMLElement {
  const wrap = el('div', 'models-row__actions');
  const serve = serveForModel(model);
  const load = loadForModel(model);

  if (load && !load.error) {
    wrap.appendChild(el('span', 'models-row__loading', load.phase));
    return wrap;
  }

  if (serve && (serve.status === 'running' || serve.status === 'starting')) {
    wrap.appendChild(
      textButton('Eject', () => {
        void unloadServe(serve.id).catch((err: unknown) => {
          setStatus('err', err instanceof Error ? err.message : 'Eject failed');
        });
      }),
    );
    return wrap;
  }

  if (model.servable) {
    const btn = textButton('Load', () => startLoad(model, btn), 'primary');
    wrap.appendChild(btn);
  }
  wrap.appendChild(
    iconButton('settings-sliders', 'Launch settings', () => {
      selectModel(model.id);
      showInspectorTab('load');
    }),
  );
  return wrap;
}

function renderRow(model: LibraryModel, selectedId: string | null): HTMLElement {
  const row = el('div', 'models-row');
  row.setAttribute('role', 'row');
  row.tabIndex = 0;
  row.dataset.modelId = model.id;
  if (model.id === selectedId) row.classList.add('is-selected');

  const serve = serveForModel(model);
  if (serve?.status === 'running') row.classList.add('is-loaded');

  const identity = el('div', 'models-row__identity');
  const nameLine = el('div', 'models-row__name-line');
  nameLine.appendChild(el('span', 'models-row__name', model.name));
  if (serve?.status === 'running') {
    const badge = el('span', 'models-row__loaded-badge', 'Loaded');
    badge.prepend(el('span', 'models-dot models-dot--running'));
    nameLine.appendChild(badge);
  }
  if (model.incomplete) {
    nameLine.appendChild(el('span', 'models-row__warn', 'Incomplete download'));
  }
  identity.append(nameLine, el('span', 'models-row__repo', model.repoId));
  row.appendChild(identity);

  for (const [modifier, value] of COLUMNS) {
    row.appendChild(el('span', `models-row__cell models-row__cell--${modifier}`, value(model)));
  }
  row.appendChild(renderRowActions(model));

  const select = () => selectModel(model.id);
  row.addEventListener('click', select);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  });
  return row;
}

function renderTable(models: LibraryModel[], selectedId: string | null): HTMLElement {
  const table = el('div', 'models-table');
  table.setAttribute('role', 'table');

  const head = el('div', 'models-table__head');
  head.setAttribute('role', 'row');
  head.appendChild(el('span', 'models-table__th', 'Model'));
  for (const [modifier] of COLUMNS) {
    head.appendChild(
      el('span', `models-table__th models-row__cell--${modifier}`, COLUMN_LABELS[modifier]),
    );
  }
  head.appendChild(el('span', 'models-table__th'));
  table.appendChild(head);

  let lastGroup = '';
  for (const model of models) {
    if (filters.sort === 'publisher' && model.publisher !== lastGroup) {
      lastGroup = model.publisher;
      table.appendChild(el('div', 'models-table__group', lastGroup));
    }
    table.appendChild(renderRow(model, selectedId));
  }
  return table;
}

/** Redraw My Models from store state. */
export function render(): void {
  const host = mount();
  if (!host) return;

  const state = getModelsState();

  if (state.scanning && !state.library.length) {
    host.replaceChildren(
      el('div', 'models-toolbar models-toolbar--placeholder'),
      skeletonRows(6),
    );
    return;
  }

  if (state.error && !state.library.length) {
    host.replaceChildren(
      emptyState({
        glyph: 'triangle-warning',
        title: 'Could not scan local models',
        body: state.error,
        action: { label: 'Try again', onClick: () => void refreshModels({ fresh: true }) },
      }),
    );
    return;
  }

  if (!state.library.length) {
    host.replaceChildren(
      emptyState({
        glyph: 'folder-open',
        title: 'No local models yet',
        body:
          'Minnow scans the Hugging Face cache, ~/.minnow/models, and any folders you add under Storage.',
        action: {
          label: 'Browse models to download',
          onClick: () => {
            void import('../models-page').then((m) => m.openModels('recommend'));
          },
        },
      }),
    );
    return;
  }

  const shown = filterLibrary(state.library, filters);
  const fragment = document.createDocumentFragment();
  fragment.appendChild(renderToolbar(state.library, shown));

  if (!shown.length) {
    fragment.appendChild(
      emptyState({
        glyph: 'search',
        title: 'No matches',
        body: 'No local model matches these filters.',
        action: {
          label: 'Clear filters',
          onClick: () => {
            filters.search = '';
            filters.format = '';
            filters.publisher = '';
            render();
          },
        },
      }),
    );
  } else {
    fragment.appendChild(renderTable(shown, state.selectedId));
  }

  host.replaceChildren(fragment);

  // The table head sticks below the toolbar, which wraps at narrow widths.
  const toolbar = host.querySelector<HTMLElement>('.models-toolbar');
  if (toolbar) host.style.setProperty('--models-toolbar-h', `${toolbar.offsetHeight}px`);

  if (searchFocused) {
    const input = host.querySelector<HTMLInputElement>('.models-search__input');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

/** Mount My Models (idempotent). */
export function mountLibrarySection(): void {
  if (!bound) {
    bound = true;
    subscribeModelsStore(() => {
      if (document.getElementById('modelsSection-installed')?.classList.contains('is-active')) {
        render();
      }
    });
  }
  render();
  void refreshModels();
}
