export type BoardScenarioPollerOptions<T> = {
  intervalMs?: number;
  fetchSnapshot: (signal: AbortSignal) => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onError?: (error: unknown) => void;
  isTerminal: (snapshot: T) => boolean;
};

/**
 * Single-flight, abortable polling used by the board scenario runner.
 * Starting a new lifecycle always aborts the previous request and timer.
 */
export class BoardScenarioPoller<T> {
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly options: BoardScenarioPollerOptions<T>) {}

  get active(): boolean {
    return this.controller != null;
  }

  start(): void {
    this.stop();
    this.controller = new AbortController();
    const generation = ++this.generation;
    void this.tick(generation);
  }

  stop(): void {
    this.generation += 1;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.controller?.abort();
    this.controller = null;
  }

  private async tick(generation: number): Promise<void> {
    const controller = this.controller;
    if (!controller || generation !== this.generation) return;

    try {
      const snapshot = await this.options.fetchSnapshot(controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return;
      this.options.onSnapshot(snapshot);
      if (this.options.isTerminal(snapshot)) {
        this.stop();
        return;
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.options.onError?.(error);
    }

    if (!this.controller || generation !== this.generation) return;
    this.timer = setTimeout(
      () => void this.tick(generation),
      this.options.intervalMs ?? 750,
    );
  }
}
