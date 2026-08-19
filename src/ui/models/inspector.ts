/**
 * Models inspector — the persistent right column.
 *
 * Info describes the selected weights, Load owns the llama.cpp launch config
 * (replacing the old serve modal), and Inference shows what the running process
 * was actually given plus per-model sampling overrides.
 */

import {
  getLibrarySamplerForId,
  loadLibraryInferencePrefs,
  saveLibraryInferenceSampler,
} from '../../config/library-inference-meta';
import {
  estimateLoadDurationMs,
  getLibraryLaunchSettingsForId,
  llamaSettingsFromLaunchPrefs,
  loadLibraryLaunchPrefs,
  saveLibraryLaunchSettings,
} from '../../config/library-launch-meta';
import {
  fetchGgufGeometry,
  fetchLlamaRuntime,
  type GgufGeometryFacts,
  type LlamaServeSettings,
} from '../../models/api-client';
import { buildSamplerFieldInputs } from '../settings-sampler-fields';
import {
  estimateServeMemory,
  estimateTransformerLayerCount,
} from '../../models/serve-memory-estimate';
import { renderLaunchMemoryMeter } from './launch-memory-meter';
import { joinArgv, tokenizeArgv } from '../../models/argv-tokenize.mjs';
import {
  applyCacheTypeTouch,
  applyCtxPerSlotTouch,
  applyGpuLayersAuto,
  applyGpuLayersTouch,
  applyPassThroughTouch,
  CONTEXT_SLIDER_MIN,
  CONTEXT_SLIDER_STEP,
  contextSliderMax,
  displayedLaunchFrom,
  inspectorLaunchPlan,
  settingsForDraft,
  snapCtxPerSlot,
  type DisplayedLaunch,
} from './inspector-launch';
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
import { setModelsInspectorOpen } from './inspector-visibility';
import { ensureRuntimeForModel } from './runtime-install-prompt';
import { serveFailureBlock } from './serve-failure-view';
import {
  getModelsState,
  getSelectedModel,
  loadModel,
  selectModel,
  serveForModel,
  subscribeModelsStore,
  unloadServe,
} from './store';
import { isRetryableServeStatus, retryLabelForServe, settingsForServeRetry } from '../../models/serve-status';

type InspectorTab = 'info' | 'load' | 'inference';

const TAB_LABELS: Record<InspectorTab, { label: string; glyph: string }> = {
  info: { label: 'Info', glyph: 'list' },
  load: { label: 'Load', glyph: 'inbox-in' },
  inference: { label: 'Inference', glyph: 'chart-simple' },
};

let activeTab: InspectorTab = 'info';
let bound = false;
let inspectorRenderRaf: number | null = null;
/**
 * Store / GGUF / runtime updates that arrived while a launch slider still had
 * focus. Flushed on blur (next frame) so we do not remount the range mid-drag.
 */
let inspectorRenderDeferred = false;
/** Per-model launch settings, kept while the app is open. Empty = auto (server planner). */
const draftSettings = new Map<string, LlamaServeSettings>();
/** Slider `input` fires every tick — debounce PUT so we do not hammer config.json. */
const launchSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const LAUNCH_SAVE_DEBOUNCE_MS = 300;

/**
 * Installed llama.cpp variant (`cuda-12.4`, …). Decides flash-attn on vs auto.
 * `hardware.backend` is the fallback until GET /api/models/llama-runtime returns.
 */
let llamaVariant: string | null = null;
let llamaVariantFetched = false;
/** Keep Advanced open across Load-tab re-renders after a slider touch. */
let loadAdvancedOpen = false;

/**
 * GGUF headers by file path — exact layer count and attention geometry for models already on
 * disk. `null` records a file we tried and could not parse, so we do not retry every render.
 */
const ggufGeometry = new Map<string, GgufGeometryFacts | null>();
const ggufGeometryPending = new Set<string>();

/** Installed variant when known, else the hardware probe — see comment on `llamaVariant`. */
function ensureLlamaVariant(): string | null {
  if (!llamaVariantFetched) {
    llamaVariantFetched = true;
    void fetchLlamaRuntime()
      .then((status) => {
        llamaVariant = status.variant;
      })
      .catch(() => {
        llamaVariant = null;
      })
      .finally(() => {
        scheduleInspectorRender();
      });
  }
  return llamaVariant || getModelsState().hardware?.backend || null;
}

/**
 * Read the header for a model's weights, re-rendering once it lands.
 * Until it does, the estimate falls back to architecture + parameter count.
 */
function ensureGgufGeometry(model: LibraryModel): GgufGeometryFacts | null {
  const filePath = model.path;
  if (!filePath || model.format !== 'GGUF') return null;
  if (ggufGeometry.has(filePath)) return ggufGeometry.get(filePath) ?? null;
  if (ggufGeometryPending.has(filePath)) return null;

  ggufGeometryPending.add(filePath);
  void fetchGgufGeometry(filePath)
    .catch(() => null)
    .then((facts) => {
      ggufGeometryPending.delete(filePath);
      ggufGeometry.set(filePath, facts);
      scheduleInspectorRender();
    });
  return null;
}

/** Geometry hints for the estimator: exact header first, catalog fields as the fallback. */
function memoryHints(model: LibraryModel): {
  gguf: GgufGeometryFacts | null;
  arch: string | null;
  name: string | null;
} {
  return {
    gguf: ensureGgufGeometry(model),
    arch: model.arch || null,
    name: model.name || null,
  };
}

function root(): HTMLElement | null {
  return document.getElementById('modelsInspector');
}

function isLaunchRange(node: EventTarget | null): node is HTMLInputElement {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as HTMLInputElement;
  // Duck-type: happy-dom tests do not install HTMLInputElement on globalThis.
  return (
    candidate.tagName === 'INPUT' &&
    candidate.type === 'range' &&
    Boolean(candidate.classList?.contains('models-field__range'))
  );
}

/** True while a Load-tab slider still has focus (mouse drag or arrow keys). */
function launchRangeHasFocus(): boolean {
  const host = root();
  const active = document.activeElement;
  return Boolean(host && isLaunchRange(active) && host.contains(active));
}

/**
 * Replace only the occupancy cluster. Rebuilding the inspector on every range
 * `input` destroys the slider and drops pointer capture after one tick.
 */
function patchLaunchMemoryMeter(model: LibraryModel): void {
  const host = root();
  if (!host) return;
  const existing = host.querySelector('.models-launch-memory');
  if (!existing) return;
  existing.replaceWith(launchMemoryHint(model, displayedFor(model)));
}

/**
 * After a deferred full render, wait a frame so the click that blurred the
 * slider still hits the existing tab or footer button.
 */
function bindLaunchRangeLifecycle(range: HTMLInputElement): void {
  range.addEventListener('blur', () => {
    if (!inspectorRenderDeferred) return;
    window.requestAnimationFrame(() => {
      if (launchRangeHasFocus()) return;
      render();
    });
  });
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
  displayed: DisplayedLaunch,
  onChange: (ctxPerSlot: number) => void,
): HTMLElement {
  const maxTokens = contextSliderMax(displayed.trainCtx);
  const minTokens = Math.min(CONTEXT_SLIDER_MIN, maxTokens);
  const ctxPerSlot = snapCtxPerSlot(displayed.ctxPerSlot, maxTokens);
  // Div, not label: Chromium retargets pointermove on a range nested in a
  // <label>, so the thumb snaps one step and the drag dies.
  const wrap = el('div', 'models-field');
  const head = el('div', 'models-field__range-head');
  head.append(el('span', 'models-field__label', 'Context length'));
  const valueText =
    displayed.parallel > 1 ? `${ctxPerSlot.toLocaleString()} / slot` : ctxPerSlot.toLocaleString();
  const valueEl = el('span', 'models-field__range-value', valueText);
  head.appendChild(valueEl);
  wrap.appendChild(head);

  const range = el('input', 'models-field__range') as HTMLInputElement;
  range.type = 'range';
  // Token values, 1k step: auto-planning still uses CONTEXT_LADDER (13 rungs).
  range.min = String(minTokens);
  range.max = String(maxTokens);
  range.step = String(CONTEXT_SLIDER_STEP);
  range.value = String(ctxPerSlot);
  range.setAttribute('aria-valuemin', range.min);
  range.setAttribute('aria-valuemax', range.max);
  range.setAttribute('aria-valuenow', range.value);
  range.setAttribute('aria-label', 'Context length in tokens per slot');
  range.addEventListener('input', () => {
    const next = snapCtxPerSlot(Number(range.value), maxTokens);
    valueEl.textContent =
      displayed.parallel > 1 ? `${next.toLocaleString()} / slot` : next.toLocaleString();
    range.setAttribute('aria-valuenow', String(next));
    onChange(next);
  });
  bindLaunchRangeLifecycle(range);
  wrap.appendChild(range);

  if (displayed.trainCtx) {
    wrap.appendChild(
      el(
        'p',
        'models-hint',
        `Trained context: ${displayed.trainCtx.toLocaleString()}`,
      ),
    );
  }
  if (displayed.parallel > 1) {
    wrap.appendChild(
      el(
        'p',
        'models-hint',
        `Per slot. Total -c is ${(ctxPerSlot * displayed.parallel).toLocaleString()} (${ctxPerSlot.toLocaleString()} × ${displayed.parallel} slots).`,
      ),
    );
  }
  return wrap;
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
 * Launch payload for Load. Empty until a control is touched — do not pre-seed 125k/999.
 * Seeds from models.launch.byLibraryId when the session Map has no row yet (reload).
 */
export function settingsFor(model: LibraryModel): LlamaServeSettings {
  return settingsForDraft(draftFor(model.id));
}

/**
 * In-memory draft, or the saved row after a reload. Progress fields (lastLoadMs)
 * stay out of the spawn payload.
 */
function draftFor(modelId: string): LlamaServeSettings | undefined {
  if (draftSettings.has(modelId)) return draftSettings.get(modelId);
  const saved = llamaSettingsFromLaunchPrefs(getLibraryLaunchSettingsForId(modelId));
  if (!saved) return undefined;
  draftSettings.set(modelId, saved);
  return saved;
}

function persistDraft(model: LibraryModel, next: LlamaServeSettings): void {
  draftSettings.set(model.id, next);
  const payload = settingsForDraft(next);
  const pending = launchSaveTimers.get(model.id);
  if (pending) clearTimeout(pending);

  // Load sends `{}` for planner auto. An empty PUT would delete the row and
  // wipe lastLoadMs, so restoring Auto writes `{ fit_mode: 'auto' }` over a
  // previously saved ngl/ctx row instead.
  let toSave: LlamaServeSettings = payload;
  if (Object.keys(payload).length === 0) {
    const savedLlama = llamaSettingsFromLaunchPrefs(getLibraryLaunchSettingsForId(model.id));
    if (!savedLlama) return;
    toSave = { fit_mode: 'auto' };
  }

  // Fire-and-forget after debounce (sampler save is immediate on `change`;
  // sliders use `input` so we wait until the user pauses).
  launchSaveTimers.set(
    model.id,
    setTimeout(() => {
      launchSaveTimers.delete(model.id);
      void saveLibraryLaunchSettings({
        libraryId: model.id,
        settings: toSave,
      }).catch(() => undefined);
    }, LAUNCH_SAVE_DEBOUNCE_MS),
  );
}

function displayedFor(model: LibraryModel): DisplayedLaunch {
  const draft = draftFor(model.id);
  const parallel = Math.max(1, draft?.parallel ?? 1);
  const gguf = ensureGgufGeometry(model);
  const plan = inspectorLaunchPlan({
    gguf,
    arch: model.arch,
    name: model.name,
    paramsB: model.paramsB,
    sizeBytes: model.sizeBytes,
    hardware: getModelsState().hardware,
    variant: ensureLlamaVariant(),
    parallel,
  });
  const trainCtx = Number(gguf?.trainCtx) > 0 ? Number(gguf?.trainCtx) : null;
  return displayedLaunchFrom(draft, plan, trainCtx);
}

function sliderValueFromNGpu(nGpuLayers: number | null | undefined, maxLayers: number): number {
  if (nGpuLayers === 0) return 0;
  // Auto (null) sits at max visually; the label says Auto, not "all / 999".
  if (nGpuLayers == null) return maxLayers;
  return Math.min(maxLayers, Math.max(0, nGpuLayers));
}

function nGpuLayersFromSlider(sliderValue: number, maxLayers: number): number {
  if (sliderValue <= 0) return 0;
  // Send the real layer count, not 999 — 999 was the old "all" sentinel the server
  // could not tell from a deliberate user choice.
  return Math.min(maxLayers, sliderValue);
}

function formatGpuLayersSliderLabel(
  sliderValue: number,
  maxLayers: number,
  auto: boolean,
): string {
  if (auto) return 'Auto';
  if (sliderValue <= 0) return 'CPU only';
  if (sliderValue >= maxLayers) return `All (${maxLayers})`;
  return String(sliderValue);
}

/** Insert the Auto restore control without remounting the range (slider ticks must keep the thumb). */
function ensureGpuAutoRestoreButton(meta: HTMLElement, onAuto: () => void): void {
  if (meta.querySelector('.models-field__auto')) return;
  const autoBtn = el('button', 'models-field__auto', 'Auto') as HTMLButtonElement;
  autoBtn.type = 'button';
  autoBtn.setAttribute('aria-label', 'Restore GPU layers to Auto');
  autoBtn.addEventListener('click', () => {
    // Drop range focus so render() is not deferred mid-drag.
    const range = meta.closest('.models-field')?.querySelector<HTMLInputElement>('.models-field__range');
    range?.blur();
    onAuto();
  });
  meta.appendChild(autoBtn);
}

function gpuLayersSlider(
  model: LibraryModel,
  displayed: DisplayedLaunch,
  onChange: (nGpuLayers: number | null) => void,
): HTMLElement {
  const maxLayers = estimateTransformerLayerCount(model.paramsB, memoryHints(model));
  const auto = displayed.n_gpu_layers == null;
  const sliderValue = sliderValueFromNGpu(displayed.n_gpu_layers, maxLayers);
  // Same label-wrap trap as contextLengthField: keep the range outside <label>.
  const wrap = el('div', 'models-field');
  const head = el('div', 'models-field__range-head');
  head.append(el('span', 'models-field__label', 'GPU layers'));
  const meta = el('div', 'models-field__range-meta');
  const valueEl = el(
    'span',
    'models-field__range-value',
    formatGpuLayersSliderLabel(sliderValue, maxLayers, auto),
  );
  meta.appendChild(valueEl);
  // The slider cannot represent "unset". Show Auto only after the user wrote a
  // count (including CPU 0). A CPU-plan 0 is not an override.
  if (draftFor(model.id)?.n_gpu_layers != null) {
    ensureGpuAutoRestoreButton(meta, () => onChange(null));
  }
  head.appendChild(meta);
  wrap.appendChild(head);

  const range = el('input', 'models-field__range') as HTMLInputElement;
  range.type = 'range';
  range.min = '0';
  range.max = String(maxLayers);
  range.step = '1';
  range.value = String(sliderValue);
  range.setAttribute('aria-valuemin', range.min);
  range.setAttribute('aria-valuemax', range.max);
  range.setAttribute('aria-valuenow', range.value);
  range.setAttribute(
    'aria-valuetext',
    auto ? 'Auto: llama.cpp sizes the GPU split' : formatGpuLayersSliderLabel(sliderValue, maxLayers, false),
  );
  range.setAttribute('aria-label', 'Transformer layers to offload to the GPU');
  range.addEventListener('input', () => {
    const nextSlider = Number(range.value);
    valueEl.textContent = formatGpuLayersSliderLabel(nextSlider, maxLayers, false);
    range.setAttribute('aria-valuenow', String(nextSlider));
    range.setAttribute(
      'aria-valuetext',
      formatGpuLayersSliderLabel(nextSlider, maxLayers, false),
    );
    // First tick leaves auto: drop the hint and reveal Auto without remounting.
    wrap.querySelector('.models-field__auto-hint')?.remove();
    ensureGpuAutoRestoreButton(meta, () => onChange(null));
    onChange(nGpuLayersFromSlider(nextSlider, maxLayers));
  });
  bindLaunchRangeLifecycle(range);
  wrap.appendChild(range);
  if (auto) {
    wrap.appendChild(
      el('p', 'models-hint models-field__auto-hint', 'Auto: llama.cpp sizes the GPU split.'),
    );
  }
  return wrap;
}

/** Occupancy meters for the current launch settings vs measured hardware. */
function launchMemoryHint(model: LibraryModel, displayed: DisplayedLaunch): HTMLElement {
  const weightsGb = model.sizeBytes > 0 ? model.sizeBytes / 1024 ** 3 : 0;
  const hw = getModelsState().hardware;
  const estimate = estimateServeMemory({
    weightsGb,
    paramsB: model.paramsB,
    ctx: displayed.ctx,
    cacheType: displayed.cache_type,
    nGpuLayers: displayed.n_gpu_layers ?? undefined,
    backend: hw?.backend ?? null,
    deviceCount: hw?.gpuCount ?? 1,
    ...memoryHints(model),
  });
  return renderLaunchMemoryMeter({ estimate, hardware: hw });
}

/** Time-based estimate from the last successful load — not a fake percent. */
function loadDurationHint(model: LibraryModel): HTMLElement | null {
  const loading = getModelsState().loads.some((l) => l.modelId === model.id && !l.error);
  // Skip while the table/footer already show load.phase text.
  if (loading) return null;
  const saved = getLibraryLaunchSettingsForId(model.id);
  if (!saved) return null;
  const lastLoadMs = Number(saved.lastLoadMs);
  const lastWeightsBytes = Number(saved.lastWeightsBytes);
  const ms = estimateLoadDurationMs(model.sizeBytes, lastLoadMs, lastWeightsBytes);
  if (ms == null) return null;
  const seconds = Math.max(1, Math.round(ms / 1000));
  const label = seconds === 1 ? '1 second' : `${seconds} seconds`;
  const sameSize = lastWeightsBytes === model.sizeBytes;
  const text = sameSize
    ? `Last load took about ${label}.`
    : `About ${label} at the last observed rate.`;
  return el('p', 'models-muted', text);
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

  const displayed = displayedFor(model);
  const draft = draftFor(model.id);
  const serve = serveForModel(model);

  const configBlock = el('section', 'models-inspector__block');
  configBlock.appendChild(el('h3', 'models-block__label', 'Launch'));

  if (serve && (serve.status === 'error' || serve.status === 'crashed')) {
    const failure = serveFailureBlock(serve);
    if (failure) configBlock.appendChild(failure);
  }

  if (!displayed.plan.fits) {
    configBlock.appendChild(el('p', 'models-hint models-hint--warning', displayed.plan.reason));
  }

  const memoryHint = launchMemoryHint(model, displayed);

  const refreshAfterTouch = (): void => {
    render();
  };

  configBlock.append(
    memoryHint,
    contextLengthField(displayed, (ctxPerSlot) => {
      persistDraft(model, applyCtxPerSlotTouch(draftFor(model.id), displayed, ctxPerSlot));
      // Keep the range mounted; only the occupancy cluster needs a live refresh.
      patchLaunchMemoryMeter(model);
    }),
    gpuLayersSlider(model, displayed, (nGpuLayers) => {
      persistDraft(
        model,
        nGpuLayers == null
          ? applyGpuLayersAuto(draftFor(model.id), displayed)
          : applyGpuLayersTouch(draftFor(model.id), displayed, nGpuLayers),
      );
      // Restoring Auto remounts so the hint and slider position return; a
      // count tick only patches the occupancy cluster so the thumb stays grabbed.
      if (nGpuLayers == null) refreshAfterTouch();
      else patchLaunchMemoryMeter(model);
    }),
  );
  configBlock.appendChild(
    selectField(
      'KV cache',
      [
        { value: 'f16', label: 'f16 — full precision' },
        { value: 'q8_0', label: 'q8_0 — balanced' },
        { value: 'q4_0', label: 'q4_0 — smaller' },
      ],
      displayed.cache_type,
      (v) => {
        persistDraft(model, applyCacheTypeTouch(draftFor(model.id), displayed, v));
        refreshAfterTouch();
      },
    ),
  );
  const durationHint = loadDurationHint(model);
  if (durationHint) configBlock.appendChild(durationHint);
  body.appendChild(configBlock);

  const advanced = el('details', 'models-advanced');
  advanced.open = loadAdvancedOpen;
  advanced.addEventListener('toggle', () => {
    loadAdvancedOpen = advanced.open;
  });
  advanced.appendChild(el('summary', 'models-advanced__summary', 'Advanced'));
  advanced.append(
    numberField('Batch size', draft?.batch_size, 'auto', (v) => {
      persistDraft(model, applyPassThroughTouch(draftFor(model.id), displayed, { batch_size: v }));
    }),
    numberField('Micro-batch', draft?.ubatch_size, 'auto', (v) => {
      persistDraft(model, applyPassThroughTouch(draftFor(model.id), displayed, { ubatch_size: v }));
    }),
    numberField('Parallel slots', draft?.parallel, '1', (v) => {
      persistDraft(model, applyPassThroughTouch(draftFor(model.id), displayed, { parallel: v }));
      refreshAfterTouch();
    }),
  );
  const extraWrap = el('label', 'models-field');
  extraWrap.append(el('span', 'models-field__label', 'Extra llama-server args'));
  const extraInput = el('input', 'models-field__input') as HTMLInputElement;
  extraInput.placeholder = '--chat-template "..." --no-mmap';
  extraInput.value = joinArgv(draft?.extra_args ?? []);
  extraInput.addEventListener('change', () => {
    const raw = extraInput.value.trim();
    // POSIX-ish tokenize so `--chat-template "hello world"` stays two argv tokens.
    const tokens = raw ? tokenizeArgv(raw) : [];
    persistDraft(
      model,
      applyPassThroughTouch(draftFor(model.id), displayed, {
        extra_args: tokens.length ? tokens : undefined,
      }),
    );
  });
  extraWrap.appendChild(extraInput);
  advanced.appendChild(extraWrap);

  const unifiedWrap = el('label', 'models-field models-field--check');
  const unified = el('input') as HTMLInputElement;
  unified.type = 'checkbox';
  unified.checked = Boolean(draft?.env?.GGML_CUDA_ENABLE_UNIFIED_MEMORY);
  unified.addEventListener('change', () => {
    persistDraft(
      model,
      applyPassThroughTouch(draftFor(model.id), displayed, {
        env: unified.checked ? { GGML_CUDA_ENABLE_UNIFIED_MEMORY: '1' } : undefined,
      }),
    );
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
          : settings.n_gpu_layers != null
            ? String(settings.n_gpu_layers)
            : settings.fit_mode === 'manual'
              ? '—'
              : 'Auto',
      ),
      infoRow('KV cache', settings.cache_type ?? '—'),
      infoRow('Fit', settings.fit_mode === 'manual' ? 'Manual' : 'Auto'),
      infoRow('Parallel', String(settings.parallel ?? 1)),
    );
    block.appendChild(list);
  } else {
    block.appendChild(
      el('p', 'models-muted', 'Load the model to see the flags its process was started with.'),
    );
  }
  body.appendChild(block);

  const samplerBlock = el('section', 'models-inspector__block models-inspector__sampler');
  samplerBlock.append(
    el('h3', 'models-block__label', 'Sampling'),
    el(
      'p',
      'models-muted',
      'Override global sampler defaults for this model. Empty fields inherit from Settings → Sampler.',
    ),
  );

  const aliases = [
    serve?.modelLabel,
    model.name,
    model.fileName ?? undefined,
  ].filter((value): value is string => Boolean(value?.trim()));

  const stored = getLibrarySamplerForId(model.id);
  const samplerFields = buildSamplerFieldInputs(stored, {
    includeMaxTokens: true,
    emptyPlaceholder: 'Inherit',
  });
  samplerBlock.appendChild(samplerFields.root);

  let skipAutoSave = true;
  const persistSampler = (): void => {
    if (skipAutoSave) return;
    const patch = samplerFields.readPatch();
    void saveLibraryInferenceSampler({
      libraryId: model.id,
      sampler: patch,
      aliases,
    })
      .then(() => {
        setStatus('ok', 'Sampling settings saved');
      })
      .catch((err: unknown) => {
        setStatus('err', err instanceof Error ? err.message : 'Could not save sampling settings');
      });
  };
  samplerFields.root.addEventListener('change', persistSampler);
  queueMicrotask(() => {
    skipAutoSave = false;
  });

  const links = el('div', 'models-link-row');
  links.append(
    textButton('Global sampler', () => openSection('sampler')),
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

  if (serve && (serve.status === 'running' || serve.status === 'starting' || serve.status === 'unhealthy')) {
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

  const retry = Boolean(serve && isRetryableServeStatus(serve.status));
  const retryLabel = serve && retry ? retryLabelForServe(serve) : 'Retry';
  const loadBtn = textButton(
    retry ? retryLabel : 'Load model',
    () => {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Starting…';
      void (async () => {
        try {
          if (!(await ensureRuntimeForModel(model))) {
            loadBtn.disabled = false;
            loadBtn.textContent = retry ? retryLabel : 'Load model';
            return;
          }
          const base = model.source === 'ollama' ? undefined : settingsFor(model);
          const payload =
            retry && serve ? settingsForServeRetry(serve, base ?? {}) : base;
          await loadModel(model, payload);
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : 'Load failed');
          loadBtn.disabled = false;
          loadBtn.textContent = retry ? retryLabel : 'Load model';
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

  // Recreating the panel mid-drag drops pointer capture on the range thumb.
  if (launchRangeHasFocus()) {
    inspectorRenderDeferred = true;
    const focusedModel = getSelectedModel();
    if (focusedModel && activeTab === 'load') patchLaunchMemoryMeter(focusedModel);
    return;
  }
  inspectorRenderDeferred = false;

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

/** Coalesce re-renders onto the next frame. */
function scheduleInspectorRender(): void {
  if (inspectorRenderRaf != null) return;
  inspectorRenderRaf = window.requestAnimationFrame(() => {
    inspectorRenderRaf = null;
    render();
  });
}

/** Wire the inspector to the store (idempotent). */
export function initInspector(): void {
  void loadLibraryInferencePrefs();
  void loadLibraryLaunchPrefs().then(() => {
    scheduleInspectorRender();
  });
  if (bound) {
    render();
    return;
  }
  bound = true;
  subscribeModelsStore(scheduleInspectorRender);
  render();
}

/**
 * Select a library row and show the inspector (opens the panel when hidden).
 * Used by My Models rows, quant pickers, and Local Server cards.
 */
export function showModelInInspector(modelId: string, tab: InspectorTab = 'info'): void {
  selectModel(modelId);
  activeTab = tab;
  setModelsInspectorOpen(true);
  render();
  queueMicrotask(() => {
    const host = root();
    if (!host) return;
    host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  });
}

/** Open the inspector on a specific tab for the current selection. */
export function showInspectorTab(tab: InspectorTab): void {
  const id = getModelsState().selectedId;
  if (!id) {
    activeTab = tab;
    setModelsInspectorOpen(true);
    render();
    return;
  }
  showModelInInspector(id, tab);
}
