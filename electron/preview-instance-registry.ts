export const DEFAULT_PREVIEW_INSTANCE_ID = 'workspace-preview';

export const DESIGN_PREVIEW_INSTANCE_ID = 'design';
export const STUDIO_FRAME_PREVIEW_INSTANCE_PREFIX = 'studio-frame:';

export const MAX_LIVE_PREVIEW_INSTANCES = 4;

interface InstanceRecord<TState> {
  instanceId: string;
  state: TState;
  visible: boolean;
  lastTouchedAt: number;
}

export interface PreviewInstanceRegistryOptions<TState> {
  createState: (instanceId: string) => TState;
  maxLiveInstances?: number;
  onEvict?: (windowId: number, instanceId: string, state: TState) => void;
}

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

  get(windowId: number, instanceId?: string): TState | undefined {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    return this.byWindow.get(windowId)?.get(id)?.state;
  }

  has(windowId: number, instanceId?: string): boolean {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    return this.byWindow.get(windowId)?.has(id) ?? false;
  }

  touch(windowId: number, instanceId?: string): void {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const record = this.byWindow.get(windowId)?.get(id);
    if (record) record.lastTouchedAt = this.nextTouch();
  }

  setVisible(windowId: number, instanceId: string | undefined, visible: boolean): void {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const record = this.byWindow.get(windowId)?.get(id);
    if (!record) return;
    record.visible = visible;
    record.lastTouchedAt = this.nextTouch();
  }

  isVisible(windowId: number, instanceId?: string): boolean {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    return this.byWindow.get(windowId)?.get(id)?.visible ?? false;
  }

  delete(windowId: number, instanceId?: string): TState | undefined {
    const id = PreviewInstanceRegistry.resolveInstanceId(instanceId);
    const instances = this.byWindow.get(windowId);
    const record = instances?.get(id);
    if (!record || !instances) return undefined;
    instances.delete(id);
    if (instances.size === 0) this.byWindow.delete(windowId);
    return record.state;
  }

  deleteWindow(windowId: number): Array<[string, TState]> {
    const instances = this.byWindow.get(windowId);
    if (!instances) return [];
    this.byWindow.delete(windowId);
    return [...instances.entries()].map(([id, record]) => [id, record.state]);
  }

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

  /** Prefer hidden LRU instances; skip eviction when every remaining instance is visible. */
  private evictIfOverCapacity(windowId: number, instances: Map<string, InstanceRecord<TState>>): void {
    if (instances.size < this.maxLiveInstances) return;

    let candidate: InstanceRecord<TState> | null = null;
    for (const record of instances.values()) {
      if (record.visible) continue;
      if (!candidate || record.lastTouchedAt < candidate.lastTouchedAt) {
        candidate = record;
      }
    }
    if (!candidate) return;

    instances.delete(candidate.instanceId);
    this.onEvict?.(windowId, candidate.instanceId, candidate.state);
  }
}
