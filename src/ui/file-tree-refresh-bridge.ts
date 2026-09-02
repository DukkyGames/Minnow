let refreshRunner: (() => Promise<void>) | null = null;
let refreshDirectoriesRunner: ((dirs: string[]) => Promise<void>) | null = null;
let renderRunner: (() => void) | null = null;
let invalidateRunner: (() => void) | null = null;

/** Wire tree refresh/render after the file panel chunk loads. */
export function registerFileTreeRefreshBridge(hooks: {
  refresh: () => Promise<void>;
  refreshDirectories?: (dirs: string[]) => Promise<void>;
  render: () => void;
  invalidateCache: () => void;
}): void {
  refreshRunner = hooks.refresh;
  refreshDirectoriesRunner = hooks.refreshDirectories ?? null;
  renderRunner = hooks.render;
  invalidateRunner = hooks.invalidateCache;
}

/** Debounced agent-tool refresh and workspace switches. */
export async function refreshFileTreeViaBridge(): Promise<void> {
  if (!refreshRunner) return;
  await refreshRunner();
}

/** Incremental directory refresh after agent writes (subtree patch, preserves scroll). */
export async function refreshDirectoriesViaBridge(dirs: string[]): Promise<void> {
  if (refreshDirectoriesRunner) {
    await refreshDirectoriesRunner(dirs);
    return;
  }
  await refreshFileTreeViaBridge();
}

/** Repaint tree rows without reloading listings (e.g. after viewer save). */
export function renderFileTreeViaBridge(): void {
  renderRunner?.();
}

/** Drop cached directory listings before a full reload. */
export function invalidateFileTreeCacheViaBridge(): void {
  invalidateRunner?.();
}
