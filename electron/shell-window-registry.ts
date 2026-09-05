/**
 * Which shell window is on which workspace.
 *
 * Modelled on {@link ../preview-instance-registry.ts PreviewInstanceRegistry}: a
 * plain map plus LRU-by-focus ordering, kept free of Electron imports so it can
 * be unit-tested.
 *
 * The path key **must** match the server's, or the duplicate-open rule silently
 * stops working on Windows and macOS. Rather than write a third normalizer —
 * there are already two, the server's `normalizeWorkspacePathKey` and the
 * client's `normalize-workspace-path.ts` — the caller injects the server's.
 */

export interface ShellWindowRecord {
  /** `BrowserWindow.id`. */
  windowId: number;
  /** Absolute workspace folder, or `''` for a window still at the folder gate. */
  workspacePath: string;
  /** Stable id handed to the renderer as `viewContext.viewId`. */
  viewId: string;
  lastFocusedAt: number;
}

export interface ShellWindowRegistryOptions {
  /** Must be the server's `normalizeWorkspacePathKey`. */
  normalizeKey: (absPath: string) => string;
}

export class ShellWindowRegistry {
  private readonly byWindowId = new Map<number, ShellWindowRecord>();
  private readonly normalizeKey: (absPath: string) => string;
  private focusCounter = 0;
  private viewCounter = 0;

  constructor(options: ShellWindowRegistryOptions) {
    this.normalizeKey = options.normalizeKey;
  }

  /** A fresh `viewId`, unique for the life of the process. */
  nextViewId(): string {
    this.viewCounter += 1;
    return `view-${this.viewCounter}`;
  }

  register(
    windowId: number,
    workspacePath: string,
    viewId: string,
  ): ShellWindowRecord {
    const record: ShellWindowRecord = {
      windowId,
      workspacePath: workspacePath ?? '',
      viewId,
      lastFocusedAt: this.nextFocus(),
    };
    this.byWindowId.set(windowId, record);
    return record;
  }

  unregister(windowId: number): ShellWindowRecord | undefined {
    const record = this.byWindowId.get(windowId);
    this.byWindowId.delete(windowId);
    return record;
  }

  get(windowId: number): ShellWindowRecord | undefined {
    return this.byWindowId.get(windowId);
  }

  /** Point an existing window at a different folder (the in-window switch). */
  retarget(windowId: number, workspacePath: string): ShellWindowRecord | undefined {
    const record = this.byWindowId.get(windowId);
    if (!record) return undefined;
    record.workspacePath = workspacePath ?? '';
    return record;
  }

  /**
   * The one window on this folder, if any. Enforcing "a folder opens in exactly
   * one view" is not just UX: `sessions.db` has a single global revision
   * counter, so two views owning the same chat rows would 409-thrash.
   */
  findByWorkspace(workspacePath: string): ShellWindowRecord | undefined {
    if (!workspacePath || !workspacePath.trim()) return undefined;
    const key = this.normalizeKey(workspacePath);
    for (const record of this.byWindowId.values()) {
      if (!record.workspacePath) continue;
      if (this.normalizeKey(record.workspacePath) === key) return record;
    }
    return undefined;
  }

  markFocused(windowId: number): void {
    const record = this.byWindowId.get(windowId);
    if (record) record.lastFocusedAt = this.nextFocus();
  }

  /** Every open window, most recently focused first. */
  list(): ShellWindowRecord[] {
    return [...this.byWindowId.values()].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
  }

  mostRecentlyFocused(): ShellWindowRecord | undefined {
    return this.list()[0];
  }

  get size(): number {
    return this.byWindowId.size;
  }

  private nextFocus(): number {
    this.focusCounter += 1;
    return this.focusCounter;
  }
}
