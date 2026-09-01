/**
 * Named preview instance registry (MIN-364): the axis that lets N parallel
 * preview surfaces (workspace right pane, Design surface, future Studio
 * live-component frames) each own a WebContentsView-backed state without
 * fighting over one host. Orthogonal to the existing per-instance *tab*
 * support in preview-host.ts — an instance is a surface, a tab is a page
 * within that surface.
 *
 * Pure data-structure module (no `electron` import) so it is testable
 * without spinning up a real BrowserWindow — see preview-guest-actions.ts
 * for the same pattern applied to guest WebContents helpers.
 */

/** Back-compat default: every existing call site that omits an instance id lands here. */
export const DEFAULT_PREVIEW_INSTANCE_ID = 'workspace-preview';

/** Reserved instance ids the renderer is expected to use (informative only — not enforced here). */
export const DESIGN_PREVIEW_INSTANCE_ID = 'design';
export const STUDIO_FRAME_PREVIEW_INSTANCE_PREFIX = 'studio-frame:';

/** Hard cap on simultaneously "live" (non-evicted) instances per window. */
export const MAX_LIVE_PREVIEW_INSTANCES = 4;

interface InstanceRecord<TState> {
  instanceId: string;
  state: TState;
  visible: boolean;
  /** Monotonic touch counter used to pick an LRU eviction candidate. */
  lastTouchedAt: number;
}

export interface PreviewInstanceRegistryOptions<TState> {
  /** Factory invoked when an instance is created for the first time. */
  createState: (instanceId: string) => TState;
  /** Cap on live instances per window (default MAX_LIVE_PREVIEW_INSTANCES). */
  maxLiveInstances?: number;
  /**
   * Called synchronously when an instance is evicted to free capacity for a
   * new one. Caller is responsible for tearing down any native resources
   * (WebContentsViews, etc.) referenced by `state`. The instance is removed
   * from the registry immediately after this returns and will be recreated
   * from scratch (via createState) if touched again.
   */
  onEvict?: (windowId: number, instanceId: string, state: TState) => void;
}

/**
 * Per-window registry of named preview instances with LRU-based eviction of
 * hidden instances once a window exceeds `maxLiveInstances`. The default
 * instance (workspace-preview) is never a *preferred* eviction target over
 * an equally-idle non-default instance, but it is not specially protected
 * either — callers that never create extra instances never trigger eviction.
 */
export class PreviewInstanceRegistry<TState> {
  private readonly byWindow = new Map<number, Map<string, InstanceRecord<TState>>>();
  private readonly createState: (instanceId: string) => TState;
  private readonly maxLiveInstances: number;
  private readonly onEvict?: (windowId: number, instanceId: string, state: TState) => void;
  private touchCounter = 0;

  constructor(options: PreviewInstanceRegistryOptions<TState>) {
    this.createState = options.createState;
    this.maxLiveInstances = options.maxLiveInstances ?? MAX_LIVE_PREVIEW_INSTANCES;
    this.onEvict = options.onEvict;
  }

  /** Normalize a possibly-undefined renderer-supplied instance id to the default. */
  static resolveInstanceId(instanceId: string | undefined | null): string {
    return typeof instanceId === 'string' && instanceId.trim()
      ? instanceId.trim()
      : DEFAULT_PREVIEW_INSTANCE_ID;
  }

  private instancesFor(windowId: number): Map<string, InstanceRecord<TState>> {
    let instances = this.byWindow.get(windowId);
    if (!instances) {
      instances = new Map();
      this.byWindow.set(windowId, instances);
    }
    return instances;
  }

  /** Get-or-create the state for (windowId, instanceId), evicting an idle instance if over capacity. */
  ensure(windowId: number, instanceId?: string): TState {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const instances = this.instancesFor(windowId);
    const existing = instances.get(id);
    if (existing) {
      existing.lastTouchedAt = this.nextTouch();
      return existing.state;
    }

    this.evictIfOverCapacity(windowId, instances);

    const state = this.createState(id);
    instances.set(id, { instanceId: id, state, visible: false, lastTouchedAt: this.nextTouch() });
    return state;
  }

  /** Read state without creating it; returns undefined if the instance does not exist. */
  get(windowId: number, instanceId?: string): TState | undefined {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    return this.byWindow.get(windowId)?.get(id)?.state;
  }

  has(windowId: number, instanceId?: string): boolean {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    return this.byWindow.get(windowId)?.has(id) ?? false;
  }

  /** Mark an instance as recently used (bumps LRU priority) without changing visibility. */
  touch(windowId: number, instanceId?: string): void {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const record = this.byWindow.get(windowId)?.get(id);
    if (record) record.lastTouchedAt = this.nextTouch();
  }

  /** Track visibility so eviction prefers hidden instances over visible ones. */
  setVisible(windowId: number, instanceId: string | undefined, visible: boolean): void {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const record = this.byWindow.get(windowId)?.get(id);
    if (!record) return;
    record.visible = visible;
    record.lastTouchedAt = this.nextTouch();
  }

  /** True when this instance is currently marked painted (renderer-gated show). */
  isVisible(windowId: number, instanceId?: string): boolean {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    return this.byWindow.get(windowId)?.get(id)?.visible ?? false;
  }

  /** Remove an instance from the registry, returning its state for caller-side teardown. */
  delete(windowId: number, instanceId?: string): TState | undefined {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const instances = this.byWindow.get(windowId);
    const record = instances?.get(id);
    if (!record || !instances) return undefined;
    instances.delete(id);
    if (instances.size === 0) this.byWindow.delete(windowId);
    return record.state;
  }

  /** Remove every instance for a window (e.g. on window close), returning [id, state] pairs. */
  deleteWindow(windowId: number): Array<[string, TState]> {
    const instances = this.byWindow.get(windowId);
    if (!instances) return [];
    this.byWindow.delete(windowId);
    return [...instances.entries()].map(([id, record]) => [id, record.state]);
  }

  /** List instance ids for a window, most-recently-touched first. */
  listInstanceIds(windowId: number): string[] {
    const instances = this.byWindow.get(windowId);
    if (!instances) return [];
    return [...instances.values()]
      .sort((a, b) => b.lastTouchedAt - a.lastTouchedAt)
      .map((record) => record.instanceId);
  }

  private nextTouch(): number {
    this.touchCounter += 1;
    return this.touchCounter;
  }

  /** Evict the least-recently-touched hidden instance if adding one more would exceed the cap. */
  private evictIfOverCapacity(windowId: number, instances: Map<string, InstanceRecord<TState>>): void {
    if (instances.size < this.maxLiveInstances) return;

    let candidate: InstanceRecord<TState> | null = null;
    for (const record of instances.values()) {
      if (record.visible) continue;
      if (!candidate || record.lastTouchedAt < candidate.lastTouchedAt) {
        candidate = record;
      }
    }
    if (!candidate) return; // All live instances are visible — allow growth past the soft cap.

    instances.delete(candidate.instanceId);
    this.onEvict?.(windowId, candidate.instanceId, candidate.state);
  }
}
