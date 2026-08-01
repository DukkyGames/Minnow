/**
 * Models inspector — the persistent right column.
 *
 * Info describes the selected weights, Load owns the llama.cpp launch config
 * (replacing the old serve modal), and Inference shows what the running process
 * was actually given plus where the global sampler lives.
 */

import { fetchServeProfiles, type LlamaServeSettings, type ServeProfile } from '../../models/api-client';
import { capabilityLabel, type LibraryModel } from '../../models/library';
import { setStatus } from '../status';
import {
  chip,
  copyField,
  el,
  emptyState,
  formatBytes,
  formatContext,
  formatParams,
  icon,
  textButton,
} from './dom';
import { ensureLlamaRuntimeInstalled } from './llama-install-prompt';
import {
  getModelsState,
  getSelectedModel,
  loadModel,
  serveForModel,
  subscribeModelsStore,
  unloadServe,
} from './store';

type InspectorTab = 'info' | 'load' | 'inference';

/** Default llama-server context when no preset or user value is set. */
const DEFAULT_CONTEXT_TOKENS = 125_000;
const CONTEXT_SLIDER_MIN = 2_048;
const CONTEXT_SLIDER_MAX = 262_144;
const CONTEXT_SLIDER_STEP = 1_000;

const TAB_LABELS: Record<InspectorTab, { label: string; glyph: string }> = {
  info: { label: 'Info', glyph: 'list' },
  load: { label: 'Load', glyph: 'inbox-in' },
  inference: { label: 'Inference', glyph: 'chart-simple' },
};

let activeTab: InspectorTab = 'info';
let bound = false;
/** Per-model launch settings, kept while the app is open. */
const draftSettings = new Map<string, LlamaServeSettings>();
const profileCache = new Map<string, ServeProfile[]>();
/** Preset key backing the current draft, or 'custom' once a field is edited. */
const draftProfileKey = new Map<string, string>();
/** Models whose draft the hardware presets have already seeded. */
const profileSeeded = new Set<string>();
let profileRequest: string | null = null;

function root(): HTMLElement | null {
  return document.getElementById('modelsInspector');
}

/** Label/value row — the definition-list pattern from the Info tab. */
function infoRow(label: string, value: Node | string): HTMLElement {
  const row = el('div', 'models-info-row');
  row.append(el('dt', 'models-info-row__label', label));
  const dd = el('dd', 'models-info-row__value');
  dd.append(typeof value === 'string' ? chip(value) : value);
  row.appendChild(dd);
  return row;
}

function capabilityCluster(model: LibraryModel): Node {
  if (!model.capabilities.length) return chip('—', 'muted');
  const wrap = el('div', 'models-cap-cluster');
  for (const cap of model.capabilities.slice(0, 4)) {
    const pill = chip(capabilityLabel(cap));
    pill.prepend(icon(cap === 'vision' ? 'eye' : cap === 'reasoning' ? 'brain' : 'bolt'));
    wrap.appendChild(pill);
  }
  return wrap;
}

function renderInfoTab(model: LibraryModel, body: HTMLElement): void {
  const list = el('dl', 'models-info-list');
  list.append(
    infoRow('Model', model.repoId),
    infoRow('File', model.fileName ?? '—'),
    infoRow('Format', model.format),
    infoRow('Quantization', model.quant || '—'),
    infoRow('Arch', model.arch || '—'),
    infoRow('Parameters', formatParams(model.paramsB)),
    infoRow('Context', formatContext(model.contextLength)),
    infoRow('Capabilities', capabilityCluster(model)),
    infoRow('Domain', model.domain),
    infoRow('Size on disk', formatBytes(model.sizeBytes)),
  );

  const infoBlock = el('section', 'models-inspector__block');
  infoBlock.append(el('h3', 'models-block__label', 'Model information'), list);
  body.appendChild(infoBlock);

  const serve = serveForModel(model);
  const apiBlock = el('section', 'models-inspector__block');
  apiBlock.appendChild(el('h3', 'models-block__label', 'API usage'));
  if (serve && serve.status === 'running') {
    apiBlock.append(
      el('p', 'models-field-label', 'API model identifier'),
      copyField(serve.modelLabel, 'Copy model identifier'),
      el('p', 'models-field-label', 'Reachable at'),
      copyField(serve.baseUrl, 'Copy base URL'),
    );
  } else {
    apiBlock.appendChild(
      el('p', 'models-muted', 'Load this model to expose it on a local OpenAI-compatible endpoint.'),
    );
  }
  body.appendChild(apiBlock);

  if (model.path) {
    const pathBlock = el('section', 'models-inspector__block');
    pathBlock.append(el('h3', 'models-block__label', 'On disk'), copyField(model.path, 'Copy file path'));
    body.appendChild(pathBlock);
  }
}

function contextLengthField(
  value: number | undefined,
  onChange: (value: number) => void,
): HTMLElement {
  const ctx = value ?? DEFAULT_CONTEXT_TOKENS;
  const wrap = el('label', 'models-field');
  const head = el('div', 'models-field__range-head');
  head.append(el('span', 'models-field__label', 'Context length'));
  const valueEl = el('span', 'models-field__range-value', ctx.toLocaleString());
  head.appendChild(valueEl);
  wrap.appendChild(head);

  const range = el('input', 'models-field__range') as HTMLInputElement;
  range.type = 'range';
  range.min = String(CONTEXT_SLIDER_MIN);
  range.max = String(CONTEXT_SLIDER_MAX);
  range.step = String(CONTEXT_SLIDER_STEP);
  range.value = String(clampContextSlider(ctx));
  range.setAttribute('aria-valuemin', range.min);
  range.setAttribute('aria-valuemax', range.max);
  range.setAttribute('aria-valuenow', range.value);
  range.setAttribute('aria-label', 'Context length in tokens');
  range.addEventListener('input', () => {
    const next = Number(range.value);
    valueEl.textContent = next.toLocaleString();
    range.setAttribute('aria-valuenow', String(next));
    onChange(next);
  });
  wrap.appendChild(range);
  return wrap;
}

function clampContextSlider(tokens: number): number {
  const stepped =
    Math.round(tokens / CONTEXT_SLIDER_STEP) * CONTEXT_SLIDER_STEP;
  return Math.min(CONTEXT_SLIDER_MAX, Math.max(CONTEXT_SLIDER_MIN, stepped));
}

function numberField(
  label: string,
  value: number | undefined,
  hint: string,
  onChange: (value: number | undefined) => void,
): HTMLElement {
  const wrap = el('label', 'models-field');
  wrap.append(el('span', 'models-field__label', label));
  const input = el('input', 'models-field__input') as HTMLInputElement;
  input.type = 'number';
  input.inputMode = 'numeric';
  input.placeholder = hint;
  if (value != null) input.value = String(value);
  input.addEventListener('change', () => {
    const next = Number(input.value);
    onChange(input.value.trim() && Number.isFinite(next) ? next : undefined);
  });
  wrap.appendChild(input);
  return wrap;
}

function selectField(
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const wrap = el('label', 'models-field');
  wrap.append(el('span', 'models-field__label', label));
  const select = el('select', 'models-field__input') as HTMLSelectElement;
  for (const opt of options) {
    const option = el('option', undefined, opt.label) as HTMLOptionElement;
    option.value = opt.value;
    if (opt.value === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

/**
 * Launch settings for a model. Starts on conservative defaults and is reseeded
 * from the balanced hardware preset as soon as sizing comes back.
 */
function settingsFor(model: LibraryModel): LlamaServeSettings {
  let draft = draftSettings.get(model.id);
  if (!draft) {
    draft = { ctx: DEFAULT_CONTEXT_TOKENS, n_gpu_layers: 999, cache_type: 'q8_0' };
    draftSettings.set(model.id, draft);
  }
  return draft;
}

/** Note that the user edited a field, so presets stop overwriting the draft. */
function markCustom(model: LibraryModel): void {
  profileSeeded.add(model.id);
  draftProfileKey.set(model.id, 'custom');
}

function applyProfile(model: LibraryModel, profile: ServeProfile): void {
  const draft = settingsFor(model);
  draft.ctx = profile.ctx;
  draft.n_gpu_layers = profile.n_gpu_layers;
  draft.cache_type = profile.cache_type;
  if (profile.n_cpu_moe) draft.n_cpu_moe = profile.n_cpu_moe;
  draftProfileKey.set(model.id, profile.key);
  profileSeeded.add(model.id);
  render();
}

function renderLoadTab(model: LibraryModel, body: HTMLElement): void {
  if (!model.servable) {
    body.appendChild(
      emptyState({
        glyph: 'triangle-warning',
        title: 'Not loadable here',
        body:
          model.format === 'GGUF'
            ? 'Minnow could not resolve a file path for these weights.'
            : `${model.format} weights need their own runtime. Minnow's local server loads GGUF through llama.cpp.`,
      }),
    );
    return;
  }

  if (model.source === 'ollama') {
    const block = el('section', 'models-inspector__block');
    block.append(
      el('h3', 'models-block__label', 'Runtime'),
      el('p', 'models-muted', 'Ollama manages this model. Minnow registers it as the active provider.'),
    );
    body.appendChild(block);
    return;
  }

  const settings = settingsFor(model);
  const profiles = profileCache.get(model.id);

  const presetBlock = el('section', 'models-inspector__block');
  presetBlock.appendChild(el('h3', 'models-block__label', 'Preset'));
  if (profiles?.length) {
    const activeKey = draftProfileKey.get(model.id);
    const row = el('div', 'models-preset-row');
    for (const profile of profiles) {
      const btn = el('button', 'models-preset', profile.label);
      btn.type = 'button';
      btn.title = profile.note;
      btn.setAttribute('aria-pressed', String(activeKey === profile.key));
      if (activeKey === profile.key) btn.classList.add('is-active');
      if (!profile.fits) btn.classList.add('is-tight');
      btn.addEventListener('click', () => applyProfile(model, profile));
      row.appendChild(btn);
    }
    presetBlock.appendChild(row);
    const tight = profiles.find((p) => !p.fits);
    if (tight) {
      presetBlock.appendChild(
        el('p', 'models-hint', 'Dimmed presets exceed the memory Minnow measured on this machine.'),
      );
    }
  } else {
    presetBlock.appendChild(el('p', 'models-muted', 'Sizing this model for your hardware…'));
    void ensureProfiles(model);
  }
  body.appendChild(presetBlock);

  const configBlock = el('section', 'models-inspector__block');
  configBlock.appendChild(el('h3', 'models-block__label', 'Launch'));
  configBlock.append(
    contextLengthField(settings.ctx, (v) => {
      settings.ctx = v;
      markCustom(model);
    }),
    selectField(
      'GPU offload',
      [
        { value: '999', label: 'All layers' },
        { value: '0', label: 'CPU only' },
        { value: 'custom', label: 'Custom…' },
      ],
      settings.n_gpu_layers === 0 ? '0' : settings.n_gpu_layers === 999 ? '999' : 'custom',
      (v) => {
        settings.n_gpu_layers = v === 'custom' ? (settings.n_gpu_layers ?? 32) : Number(v);
        markCustom(model);
        render();
      },
    ),
  );
  if (settings.n_gpu_layers !== 0 && settings.n_gpu_layers !== 999) {
    configBlock.appendChild(
      numberField('Layers on GPU', settings.n_gpu_layers, '32', (v) => {
        settings.n_gpu_layers = v ?? 32;
        markCustom(model);
      }),
    );
  }
  configBlock.appendChild(
    selectField(
      'KV cache',
      [
        { value: 'q8_0', label: 'q8_0 — balanced' },
        { value: 'q4_0', label: 'q4_0 — smaller' },
        { value: 'f16', label: 'f16 — full precision' },
      ],
      settings.cache_type ?? 'q8_0',
      (v) => {
        settings.cache_type = v;
        markCustom(model);
      },
    ),
  );
  body.appendChild(configBlock);

  const advanced = el('details', 'models-advanced');
  advanced.appendChild(el('summary', 'models-advanced__summary', 'Advanced'));
  advanced.append(
    numberField('Batch size', settings.batch_size, 'auto', (v) => {
      settings.batch_size = v;
      markCustom(model);
    }),
    numberField('Micro-batch', settings.ubatch_size, 'auto', (v) => {
      settings.ubatch_size = v;
      markCustom(model);
    }),
    numberField('Parallel slots', settings.parallel, '1', (v) => {
      settings.parallel = v;
      markCustom(model);
    }),
  );
  const extraWrap = el('label', 'models-field');
  extraWrap.append(el('span', 'models-field__label', 'Extra llama-server args'));
  const extraInput = el('input', 'models-field__input') as HTMLInputElement;
  extraInput.placeholder = '--no-mmap --flash-attn';
  extraInput.value = (settings.extra_args ?? []).join(' ');
  extraInput.addEventListener('change', () => {
    const raw = extraInput.value.trim();
    settings.extra_args = raw ? raw.split(/\s+/) : undefined;
    markCustom(model);
  });
  extraWrap.appendChild(extraInput);
  advanced.appendChild(extraWrap);

  const unifiedWrap = el('label', 'models-field models-field--check');
  const unified = el('input') as HTMLInputElement;
  unified.type = 'checkbox';
  unified.checked = Boolean(settings.env?.GGML_CUDA_ENABLE_UNIFIED_MEMORY);
  unified.addEventListener('change', () => {
    settings.env = unified.checked ? { GGML_CUDA_ENABLE_UNIFIED_MEMORY: '1' } : undefined;
    markCustom(model);
  });
  unifiedWrap.append(unified, el('span', undefined, 'CUDA unified memory'));
  advanced.appendChild(unifiedWrap);
  body.appendChild(advanced);
}

function renderInferenceTab(model: LibraryModel, body: HTMLElement): void {
  const serve = serveForModel(model);
  const block = el('section', 'models-inspector__block');
  block.appendChild(el('h3', 'models-block__label', 'Runtime flags'));

  if (serve && serve.llamaSettings) {
    const list = el('dl', 'models-info-list');
    const settings = serve.llamaSettings as LlamaServeSettings;
    list.append(
      infoRow('Context', settings.ctx != null ? String(settings.ctx) : '—'),
      infoRow(
        'GPU layers',
        settings.n_gpu_layers === 0
          ? 'CPU only'
          : settings.n_gpu_layers === 999
            ? 'All'
            : String(settings.n_gpu_layers ?? '—'),
      ),
      infoRow('KV cache', settings.cache_type ?? '—'),
      infoRow('Parallel', String(settings.parallel ?? 1)),
    );
    block.appendChild(list);
  } else {
    block.appendChild(
      el('p', 'models-muted', 'Load the model to see the flags its process was started with.'),
    );
  }
  body.appendChild(block);

  const samplerBlock = el('section', 'models-inspector__block');
  samplerBlock.append(
    el('h3', 'models-block__label', 'Sampling'),
    el(
      'p',
      'models-muted',
      'Temperature, top-p, and penalties are set once and apply to every model Minnow talks to.',
    ),
  );
  const links = el('div', 'models-link-row');
  links.append(
    textButton('Sampler', () => openSection('sampler')),
    textButton('Thinking', () => openSection('thinking')),
  );
  samplerBlock.appendChild(links);
  body.appendChild(samplerBlock);
}

function openSection(section: string): void {
  void import('../models-page').then((m) => {
    m.openModels(section as import('../models-page').ModelsSectionId);
  });
}

/** Fetch and cache hardware-sized presets for a model. */
async function ensureProfiles(model: LibraryModel): Promise<void> {
  if (profileCache.has(model.id) || profileRequest === model.id) return;
  profileRequest = model.id;
  try {
    const { profiles } = await fetchServeProfiles({
      model: model.name,
      quant: model.quant || undefined,
      params_b: model.paramsB ?? undefined,
      weights_gb: model.sizeBytes / 1024 ** 3,
      is_moe: model.isMoe,
    });
    profileCache.set(model.id, profiles);
    const balanced =
      profiles.find((p) => p.key === 'balanced' && p.fits) ??
      profiles.find((p) => p.fits) ??
      profiles[0];
    // Seed once; a user who already touched a field keeps their values.
    if (balanced && !profileSeeded.has(model.id)) applyProfile(model, balanced);
    else render();
  } catch {
    profileCache.set(model.id, []);
    render();
  } finally {
    profileRequest = null;
  }
}

function renderFooter(model: LibraryModel, footer: HTMLElement): void {
  const serve = serveForModel(model);
  const state = getModelsState();
  const load = state.loads.find((l) => l.modelId === model.id);

  if (load && !load.error) {
    const btn = textButton('Cancel load', () => {
      void unloadServe(load.serveId).catch((err: unknown) => {
        setStatus('err', err instanceof Error ? err.message : 'Could not stop the runtime');
      });
    });
    footer.appendChild(btn);
    return;
  }

  if (serve && (serve.status === 'running' || serve.status === 'starting')) {
    footer.appendChild(
      textButton(
        'Eject',
        () => {
          void unloadServe(serve.id).catch((err: unknown) => {
            setStatus('err', err instanceof Error ? err.message : 'Eject failed');
          });
        },
        'danger',
      ),
    );
    return;
  }

  if (!model.servable) return;

  const loadBtn = textButton(
    'Load model',
    () => {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Starting…';
      void (async () => {
        try {
          if (model.source !== 'ollama' && !(await ensureLlamaRuntimeInstalled())) {
            loadBtn.disabled = false;
            loadBtn.textContent = 'Load model';
            return;
          }
          const key = draftProfileKey.get(model.id);
          await loadModel(model, model.source === 'ollama' ? undefined : settingsFor(model), {
            profile: key && key !== 'custom' ? key : undefined,
          });
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : 'Load failed');
          loadBtn.disabled = false;
          loadBtn.textContent = 'Load model';
        }
      })();
    },
    'primary',
  );
  footer.appendChild(loadBtn);
}

/** Redraw the inspector from current store state. */
export function render(): void {
  const host = root();
  if (!host) return;

  const model = getSelectedModel();
  host.classList.toggle('is-empty', !model);

  if (!model) {
    host.replaceChildren(
      emptyState({
        glyph: 'chip',
        title: 'No model selected',
        body: 'Pick a model to see its metadata, launch settings, and endpoint.',
      }),
    );
    return;
  }

  const head = el('header', 'models-inspector__head');
  const glyph = icon('chip', 'models-inspector__glyph');
  const title = el('h2', 'models-inspector__title', model.name);
  title.title = model.repoId;
  head.append(glyph, title);

  const serve = serveForModel(model);
  if (serve) {
    const dot = el('span', `models-dot models-dot--${serve.status}`);
    dot.title = `Runtime ${serve.status}`;
    head.appendChild(dot);
  }

  const tabs = el('div', 'models-inspector__tabs');
  tabs.setAttribute('role', 'tablist');
  for (const id of ['info', 'load', 'inference'] as InspectorTab[]) {
    const meta = TAB_LABELS[id];
    const tab = el('button', 'models-tab', meta.label);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(activeTab === id));
    tab.prepend(icon(meta.glyph));
    tab.addEventListener('click', () => {
      activeTab = id;
      render();
    });
    tabs.appendChild(tab);
  }

  const body = el('div', 'models-inspector__body');
  body.setAttribute('role', 'tabpanel');
  if (activeTab === 'info') renderInfoTab(model, body);
  else if (activeTab === 'load') renderLoadTab(model, body);
  else renderInferenceTab(model, body);

  const footer = el('footer', 'models-inspector__footer');
  renderFooter(model, footer);

  host.replaceChildren(head, tabs, body);
  if (footer.childElementCount) host.appendChild(footer);
}

/** Wire the inspector to the store (idempotent). */
export function initInspector(): void {
  if (bound) {
    render();
    return;
  }
  bound = true;
  subscribeModelsStore(() => render());
  render();
}

/** Open the inspector on a specific tab (used by the row action buttons). */
export function showInspectorTab(tab: InspectorTab): void {
  activeTab = tab;
  render();
}
