/**
 * Lightweight pub/sub for preview auto-reload when files are saved in Minnow.
 */

type FileSavedListener = (path: string) => void;

const listeners = new Set<FileSavedListener>();

/** Subscribe to workspace file saves performed inside Minnow. */
export function onFileSaved(listener: FileSavedListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Emit after a successful save_file from the file viewer. */
export function emitFileSaved(path: string): void {
  for (const listener of listeners) {
    listener(path);
  }
}

/** Test helper: clear all listeners. */
export function resetPreviewEventsForTests(): void {
  listeners.clear();
}
