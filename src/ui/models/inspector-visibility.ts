/**
 * Models workbench inspector panel show/hide (persisted in localStorage).
 * Kept separate from models-page.ts so library/inspector panels can open it
 * without a circular import through models-sections.
 */

const STORAGE_KEY = 'minnow.models.inspector';

function modelsRoot(): HTMLElement | null {
  return document.getElementById('modelsView');
}

/** Whether the right-hand inspector column is visible on workbench sections. */
export function isModelsInspectorOpen(): boolean {
  return !modelsRoot()?.classList.contains('is-inspector-hidden');
}

/** Show or hide the inspector; syncs the header toggle and localStorage. */
export function setModelsInspectorOpen(open: boolean): void {
  const root = modelsRoot();
  root?.classList.toggle('is-inspector-hidden', !open);
  const toggle = document.getElementById('btnModelsInspector');
  toggle?.setAttribute('aria-expanded', String(open));
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/** Read persisted preference, or null when unavailable. */
export function readModelsInspectorPreference(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
