export interface LoadPhaseSpec {
  key: string;
  label: string;
  floor: number;
  ceiling: number;
  pattern: RegExp | null;
}

export declare const LOAD_PHASES: ReadonlyArray<LoadPhaseSpec>;
export declare const MAX_PERCENT_BEFORE_HEALTHY: number;

export interface MatchedLoadPhase {
  key: string;
  label: string;
  floor: number;
  ceiling: number;
}

export declare function matchLoadPhase(text: string | null | undefined): MatchedLoadPhase;

export declare function parseSpecContextBytes(text: string | null | undefined): number | null;

export declare function resolveBytesPerMs(priors: {
  lastLoadMs?: unknown;
  lastWeightsBytes?: unknown;
  variantBytesPerMs?: unknown;
}): number;

export declare function updateLoadRate(
  previousBytesPerMs: unknown,
  sample: { loadMs?: unknown; weightsBytes?: unknown },
): number;

export interface LoadProgressInput {
  /** Everything the serve has printed so far. */
  logText?: string;
  /** Wall time since the process was spawned. */
  elapsedMs: number;
  /** Size of the weights being loaded. */
  weightsBytes?: number;
  /** From `resolveBytesPerMs`; 0 disables the time model. */
  bytesPerMs?: number;
  /** Last value shown, to hold the bar monotonic. */
  previousPercent?: number | null;
  /** Elapsed ms on the previous tick, so skipped-phase catch-up can be rate-limited. */
  lastElapsedMs?: number | null;
  /**
   * Runtime-printed percent. Null or omitted means none — never coerce that to 0
   * (`Number(null) === 0` pins the Local Server chip at 0% for the whole load).
   */
  reportedPercent?: number | null;
  /** `/health` has answered — the only way to reach 100. */
  healthy?: boolean;
}

export interface LoadProgressResult {
  /** 0–100, monotonic against `previousPercent`. */
  percent: number;
  phaseKey: string;
  label: string;
  /** Remaining time, or null when there is no usable model. */
  etaMs: number | null;
  /** False when the number came from the runtime itself. */
  modelled: boolean;
}

export declare function computeLoadProgress(input: LoadProgressInput): LoadProgressResult;

/** Compact percent for chips and chat (`37%`). Empty at 0. */
export declare function formatLoadPercentLabel(percent: unknown): string;
