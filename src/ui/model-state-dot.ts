import { modelCache } from '../app-state';
import { isModelLoadUnloadBusy, getModelLoadUnloadPhase } from '../ui/model-load-unload-button';
import type { LmModelRecord } from '../types';

/** Visual load state for the selected model row in the top bar. */
export type ModelLoadState = 'loaded' | 'unloaded' | 'unknown' | 'loading';

/** True when the provider reports the model is loaded in memory. */
export function isModelLoaded(record?: LmModelRecord | null): boolean {
  return record?.state === 'loaded';
}

/** Map a cached model row to loaded / unloaded / unknown. */
export function resolveModelState(record?: LmModelRecord | null): ModelLoadState {
  if (!record) return 'unknown';
  return isModelLoaded(record) ? 'loaded' : 'unloaded';
}

const DOT_TITLES: Record<ModelLoadState, string> = {
  loaded: 'Loaded in LM Studio',
  unloaded: 'Not loaded',
  unknown: 'Load state unknown',
  loading: 'Loading model…',
};

function loadingDotTitle(): string {
  return getModelLoadUnloadPhase() === 'unload' ? 'Unloading model…' : DOT_TITLES.loading;
}

/** Sync the green/grey dot and accessibility labels with the current model selection. */
export function updateModelStateDot(modelId?: string): void {
  const wrap = document.querySelector('.model-wrap') as HTMLElement | null;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const dot = document.getElementById('modelStateDot') as HTMLElement | null;
  if (!wrap || !sel) return;

  const id = (modelId ?? sel.value).trim();
  let dataState: ModelLoadState = 'unknown';
  if (isModelLoadUnloadBusy()) {
    dataState = 'loading';
  } else if (id) {
    const cached = modelCache.get(id);
    dataState = cached ? resolveModelState(cached) : 'unknown';
  }

  wrap.dataset.modelState = dataState;

  if (dot) {
    dot.title = dataState === 'loading' ? loadingDotTitle() : DOT_TITLES[dataState];
    dot.dataset.loadState = dataState;
  }

  const optionLabel = sel.options[sel.selectedIndex]?.text?.trim() || id || 'Model';
  const loadSuffix =
    dataState === 'loading'
      ? ', loading'
      : dataState === 'loaded'
        ? ', loaded'
        : dataState === 'unloaded'
          ? ', not loaded'
          : '';
  sel.setAttribute('aria-label', `Model: ${optionLabel}${loadSuffix}`);
}
