/**
 * Shared Load/Unload button UI — spinner + label while a model action is in flight.
 */

export type ModelLoadUnloadPhase = 'load' | 'unload';

let inFlight = false;
let phase: ModelLoadUnloadPhase | null = null;

/** True while a model load or unload request is running. */
export function isModelLoadUnloadBusy(): boolean {
  return inFlight;
}

/** Current load/unload phase when {@link isModelLoadUnloadBusy} is true. */
export function getModelLoadUnloadPhase(): ModelLoadUnloadPhase | null {
  return phase;
}

function emitModelLoadUnloadChanged(): void {
  if (typeof document === 'undefined') return;
  const CustomEventCtor = (document.defaultView ?? globalThis).CustomEvent;
  document.dispatchEvent(new CustomEventCtor('minnow:model-load-unload-changed'));
}

/** Mark the start of a load/unload action. */
export function beginModelLoadUnload(nextPhase: ModelLoadUnloadPhase): void {
  inFlight = true;
  phase = nextPhase;
  emitModelLoadUnloadChanged();
}

/** Mark the end of a load/unload action. */
export function endModelLoadUnload(): void {
  inFlight = false;
  phase = null;
  emitModelLoadUnloadChanged();
}

function busyLabel(nextPhase: ModelLoadUnloadPhase | null): string {
  return nextPhase === 'unload' ? 'Unloading…' : 'Loading…';
}

/** Show spinner + progress label on a Load/Unload button. */
export function setModelLoadUnloadButtonBusy(
  btn: HTMLButtonElement,
  nextPhase: ModelLoadUnloadPhase | null,
): void {
  const label = busyLabel(nextPhase);
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML =
    '<span class="model-load-unload-spinner" aria-hidden="true"></span>' +
    `<span class="model-load-unload-label">${label}</span>`;
  btn.setAttribute('aria-label', label);
  btn.title = 'Model action in progress…';
}

/** Restore idle Load/Unload label and enabled state. */
export function setModelLoadUnloadButtonIdle(
  btn: HTMLButtonElement,
  loaded: boolean,
  hasSelection: boolean,
): void {
  btn.classList.remove('is-busy');
  btn.removeAttribute('aria-busy');
  btn.textContent = loaded ? 'Unload' : 'Load';
  btn.setAttribute('aria-label', loaded ? 'Unload model' : 'Load model');
  btn.disabled = !hasSelection;

  if (!hasSelection) {
    btn.title = 'Select a model to load or unload';
  } else if (loaded) {
    btn.title = 'Unload selected model from VRAM';
  } else {
    btn.title = 'Load selected model into VRAM';
  }
}

/** Reset a hidden/disabled Load button when the provider does not support load/unload. */
export function setModelLoadUnloadButtonUnsupported(
  btn: HTMLButtonElement,
  serverMode: boolean,
): void {
  btn.hidden = true;
  btn.disabled = true;
  btn.classList.remove('is-busy');
  btn.removeAttribute('aria-busy');
  btn.textContent = 'Load';
  btn.setAttribute('aria-label', 'Load model');
  btn.title = serverMode
    ? 'Model load/unload is not supported for this provider'
    : 'Start with npm start to load or unload models';
}
