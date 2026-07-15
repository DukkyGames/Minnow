/**
 * Internal controller types shared across registry, scheduler, and controller.
 */

import type { SubAgentRun } from '../types';

/** Queued spawn waiting for a concurrency slot. */
export interface QueuedItem {
  runId: string;
  modeId: string;
}

/** Per-run mutable state held by the controller (not exposed on SubAgentRun). */
export interface RunInternals {
  run: SubAgentRun;
  abort: AbortController;
  timeoutId: ReturnType<typeof setTimeout> | null;
  nudgeTimeoutId: ReturnType<typeof setTimeout> | null;
  toolCallLog: Array<{ name: string; args: string }>;
  queued: boolean;
  /** True after this run consumed a global/type concurrency slot. */
  holdsConcurrencySlot: boolean;
  /** Mode used for tool allow/deny when executing nested tools. */
  toolModeId: string;
  /** Parent spawn mode id (before tool-mode resolution). */
  spawnModeId: string;
  /** Per-spawn wall-clock timeout override (ms); wins over type/global defaults. */
  spawnTimeoutMs?: number;
}
