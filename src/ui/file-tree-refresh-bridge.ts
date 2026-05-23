/**
 * Lazy file-tree refresh hooks registered by init-file-panel (avoids pulling file-tree into main).
 */

let refreshRunner: (() => Promise<void>) | null = null;
let renderRunner: (() => void) | null = null;
let invalidateRunner: (() => void) | null = null;

/** Wire tree refresh/render after the file panel chunk loads. */
export function registerFileTreeRefreshBridge(hooks: {
  refresh: () => Promise<void>;
  render: () => void;
  invalidateCache: () => void;
}): void {
  refreshRunner = hooks.refresh;
  renderRunner = hooks.render;
  invalidateRunner = hooks.invalidateCache;
}

/** Debounced agent-tool refresh and workspace switches. */
export async function refreshFileTreeViaBridge(): Promise<void> {
  if (!refreshRunner) return;
  await refreshRunner();
}

/** Repaint tree rows without reloading listings (e.g. after viewer save). */
export function renderFileTreeViaBridge(): void {
  renderRunner?.();
}

/** Drop cached directory listings before a full reload. */
export function invalidateFileTreeCacheViaBridge(): void {
  invalidateRunner?.();
}
