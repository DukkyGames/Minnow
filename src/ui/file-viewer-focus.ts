/**
 * Detect when CodeMirror in the file viewer has focus (skip tree shortcuts).
 */

/** True when focus is inside the file viewer CodeMirror surface. */
export function isFileViewerEditorFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return Boolean(active.closest('.cm-editor'));
}
