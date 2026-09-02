export function isFileViewerEditorFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return Boolean(active.closest('.cm-editor'));
}
