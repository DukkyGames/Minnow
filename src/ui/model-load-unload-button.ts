/**
 * Shared Load/Unload button UI — spinner + label while a model action is in flight.
 */

import {
  beginModelLoadLock,
  endModelLoadLock,
  getModelLoadLockOwner,
  getModelLoadLockPhase,
  getModelLoadLockTargetSelectValue,
  isModelLoadLockBusy,
  modelLoadLockHeldLabel,
  type ModelLoadUnloadPhase,
} from '../models/load-lock';
import { iconHtml } from './icon';

export type { ModelLoadUnloadPhase };

/** Download-into-tray icon for compact Load affordances. */
const LOAD_ICON_HTML = iconHtml('download');

/** Eject-from-tray icon for compact Unload affordances. */
const UNLOAD_ICON_HTML = iconHtml('upload');

/** True while a model load or unload request is running. */
export function isModelLoadUnloadBusy(): boolean {
  return isModelLoadLockBusy();
}

/** Current load/unload phase when {@link isModelLoadUnloadBusy} is true. */
export function getModelLoadUnloadPhase(): ModelLoadUnloadPhase | null {
  return getModelLoadLockPhase();
}

/** Option value for the in-flight load/unload action, when {@link isModelLoadUnloadBusy}. */
export function getModelLoadUnloadTargetSelectValue(): string | null {
  return getModelLoadLockTargetSelectValue();
}

/** Label when another subsystem holds the load lock (e.g. capability matrix). */
export function getModelLoadUnloadHeldLabel(): string | null {
  return modelLoadLockHeldLabel();
}

function emitModelLoadUnloadChanged(): void {
  if (typeof document === 'undefined') return;
  const CustomEventCtor = (document.defaultView ?? globalThis).CustomEvent;
  document.dispatchEvent(new CustomEventCtor('minnow:model-load-unload-changed'));
}

/** Mark the start of a load/unload action from the model picker. */
export function beginModelLoadUnload(
  nextPhase: ModelLoadUnloadPhase,
  selectValue?: string,
): void {
  beginModelLoadLock('ui', nextPhase, selectValue);
  emitModelLoadUnloadChanged();
}

/** Mark the end of a load/unload action from the model picker. */
export function endModelLoadUnload(): void {
  endModelLoadLock('ui');
  emitModelLoadUnloadChanged();
}

/** Which subsystem owns the load lock (for disabled-state copy). */
export function getModelLoadUnloadLockOwner(): ReturnType<typeof getModelLoadLockOwner> {
  return getModelLoadLockOwner();
}

function busyLabel(nextPhase: ModelLoadUnloadPhase | null): string {
  const held = modelLoadLockHeldLabel();
  if (held) return held;
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
  btn.title = modelLoadLockHeldLabel() ?? 'Model action in progress…';
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
    : 'Open Minnow to load or unload models';
}

/** Show spinner on a compact icon-only Load/Unload control. */
export function setModelLoadUnloadIconButtonBusy(
  btn: HTMLButtonElement,
  nextPhase: ModelLoadUnloadPhase | null,
): void {
  const label = busyLabel(nextPhase);
  btn.hidden = false;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="model-load-unload-spinner" aria-hidden="true"></span>';
  btn.setAttribute('aria-label', label);
  btn.title = modelLoadLockHeldLabel() ?? 'Model action in progress…';
}

/** Restore idle load/unload icon on a compact control. */
export function setModelLoadUnloadIconButtonIdle(
  btn: HTMLButtonElement,
  loaded: boolean,
  hasSelection: boolean,
): void {
  btn.hidden = false;
  btn.classList.remove('is-busy');
  btn.removeAttribute('aria-busy');
  btn.innerHTML = loaded ? UNLOAD_ICON_HTML : LOAD_ICON_HTML;
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

/** Hide a compact load/unload icon when the provider does not support it. */
export function setModelLoadUnloadIconButtonUnsupported(
  btn: HTMLButtonElement,
  serverMode: boolean,
): void {
  btn.hidden = true;
  btn.disabled = true;
  btn.classList.remove('is-busy');
  btn.removeAttribute('aria-busy');
  btn.innerHTML = LOAD_ICON_HTML;
  btn.setAttribute('aria-label', 'Load model');
  btn.title = serverMode
    ? 'Model load/unload is not supported for this provider'
    : 'Open Minnow to load or unload models';
}
