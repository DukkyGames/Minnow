/**
 * Run supervision wrapper — heartbeat ticks and progress bumps (MIN-140 Phase 1–2).
 */

import type { SubAgentRun } from '../types';
import { randomUUID } from '../../lib/random-id.ts';

/** Supervision fields shared by SubAgentRun and chat-backed task tracking. */
export interface RunSupervision {
  lastHeartbeatAt: number | null;
  lastProgressAt: number | null;
  progressSeq: number;
  attempt: number;
  idempotencyKey: string | null;
  committedResultRef: string | null;
}

/** Heartbeat thresholds (H, P, D) from sub-agents config. */
export interface HeartbeatConfig {
  heartbeatIntervalMs: number;
  progressStallMs: number;
  heartbeatDeadMs: number;
}

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  heartbeatIntervalMs: 10_000,
  progressStallMs: 300_000,
  heartbeatDeadMs: 90_000,
};

/** Prefix for chat-backed board task supervision run ids. */
export const CHAT_TASK_RUN_PREFIX = 'chat-task:';

/** Writable supervision holder (SubAgentRun or parallel chat-task row). */
export type SupervisionHolder = {
  lastHeartbeatAt?: number | null;
  lastProgressAt?: number | null;
  progressSeq?: number;
  attempt?: number;
  idempotencyKey?: string | null;
  committedResultRef?: string | null;
};

interface SupervisionEntry {
  target: SupervisionHolder;
  timer: ReturnType<typeof setInterval> | null;
  onTick?: () => void;
}

const entries = new Map<string, SupervisionEntry>();

/** Monotonic baseline; advanced when the page was hidden so hidden time is excluded. */
let visibilityBaseline = performance.now();

/** Frozen monotonic clock while `document.hidden` (display off / background tab). */
let pageHiddenAtMono: number | null = null;

let heartbeatConfig: HeartbeatConfig = { ...DEFAULT_HEARTBEAT_CONFIG };

let visibilityListenerBound = false;

function effectiveMonoNow(): number {
  if (pageHiddenAtMono !== null) return pageHiddenAtMono;
  return performance.now();
}

function monotonicDelta(): number {
  return effectiveMonoNow() - visibilityBaseline;
}

/** Monotonic clock for supervision timestamps (shared with the controller watchdog). */
export function supervisionMonotonicNow(): number {
  return monotonicDelta();
}

function onPageHidden(): void {
  pageHiddenAtMono = performance.now();
}

function onPageVisible(): void {
  if (pageHiddenAtMono !== null) {
    visibilityBaseline += performance.now() - pageHiddenAtMono;
    pageHiddenAtMono = null;
  }
  resetHeartbeatBaselines();
}

function ensureVisibilityListener(): void {
  if (visibilityListenerBound || typeof document === 'undefined') return;
  visibilityListenerBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      onPageHidden();
      return;
    }
    if (document.visibilityState === 'visible') {
      onPageVisible();
    }
  });
}

/** Drive visibility freeze logic in tests without a real `visibilitychange` event. */
export function simulatePageVisibilityForTests(state: 'visible' | 'hidden'): void {
  if (state === 'hidden') {
    onPageHidden();
    return;
  }
  onPageVisible();
}

/** Reset heartbeat/progress age baselines after the tab becomes visible. */
export function resetHeartbeatBaselines(): void {
  visibilityBaseline = performance.now();
  for (const entry of entries.values()) {
    entry.target.lastHeartbeatAt = null;
    entry.target.lastProgressAt = null;
  }
}

/** True while the page is hidden (display off / background tab) — stall watchdog must not fire. */
export function isSupervisionPageHidden(): boolean {
  return pageHiddenAtMono !== null;
}

/** Update observe-only thresholds from merged sub-agents config. */
export function setHeartbeatConfig(config: Partial<HeartbeatConfig>): void {
  heartbeatConfig = {
    heartbeatIntervalMs:
      config.heartbeatIntervalMs ?? heartbeatConfig.heartbeatIntervalMs,
    progressStallMs: config.progressStallMs ?? heartbeatConfig.progressStallMs,
    heartbeatDeadMs: config.heartbeatDeadMs ?? heartbeatConfig.heartbeatDeadMs,
  };
}

export function getHeartbeatConfig(): HeartbeatConfig {
  return { ...heartbeatConfig };
}

function mintIdempotencyKey(): string {
  return randomUUID();
}

/** Create default supervision fields for a new dispatch. */
export function createRunSupervision(
  partial?: Partial<RunSupervision>,
): RunSupervision {
  return {
    lastHeartbeatAt: partial?.lastHeartbeatAt ?? null,
    lastProgressAt: partial?.lastProgressAt ?? null,
    progressSeq: partial?.progressSeq ?? 0,
    attempt: partial?.attempt ?? 1,
    idempotencyKey: partial?.idempotencyKey ?? mintIdempotencyKey(),
    committedResultRef: partial?.committedResultRef ?? null,
  };
}

/** Apply supervision defaults onto a SubAgentRun row at dispatch. */
export function applySupervisionToRun(
  run: SubAgentRun,
  partial?: Partial<RunSupervision>,
): void {
  const supervision = createRunSupervision(partial);
  run.lastHeartbeatAt = supervision.lastHeartbeatAt;
  run.lastProgressAt = supervision.lastProgressAt;
  run.progressSeq = supervision.progressSeq;
  run.attempt = supervision.attempt;
  run.idempotencyKey = supervision.idempotencyKey;
  run.committedResultRef = supervision.committedResultRef;
}

/** Run id for a board task chat session. */
export function chatTaskRunId(chatId: string): string {
  return `${CHAT_TASK_RUN_PREFIX}${chatId}`;
}

function ensureEntry(runId: string, target?: RunSupervision): SupervisionEntry {
  const existing = entries.get(runId);
  if (existing) return existing;
  const entry: SupervisionEntry = {
    target: target ?? createRunSupervision(),
    timer: null,
  };
  entries.set(runId, entry);
  return entry;
}

/** Bind an existing supervision object (SubAgentRun or parallel map row). */
export function bindRunSupervision(runId: string, target: SupervisionHolder): void {
  const existing = entries.get(runId);
  if (existing?.timer) {
    clearInterval(existing.timer);
  }
  entries.set(runId, {
    target,
    timer: existing?.timer ?? null,
    onTick: existing?.onTick,
  });
  ensureVisibilityListener();
}

/** Read supervision snapshot for a run (sub-agent or chat-backed). */
export function getRunSupervision(runId: string): RunSupervision | null {
  const target = entries.get(runId)?.target;
  if (!target) return null;
  return {
    lastHeartbeatAt: target.lastHeartbeatAt ?? null,
    lastProgressAt: target.lastProgressAt ?? null,
    progressSeq: target.progressSeq ?? 0,
    attempt: target.attempt ?? 1,
    idempotencyKey: target.idempotencyKey ?? null,
    committedResultRef: target.committedResultRef ?? null,
  };
}

/** Record a heartbeat tick on the run supervision row. */
export function recordHeartbeat(runId: string): void {
  const entry = entries.get(runId);
  if (!entry) return;
  entry.target.lastHeartbeatAt = monotonicDelta();
}

/** Bump progress sequence and last-progress timestamp. */
export function bumpProgress(runId: string): void {
  const entry = entries.get(runId);
  if (!entry) return;
  entry.target.progressSeq = (entry.target.progressSeq ?? 0) + 1;
  entry.target.lastProgressAt = monotonicDelta();
}

/** Start periodic heartbeat ticks every H ms for a supervised run. */
export function startHeartbeat(runId: string, onTick?: () => void): void {
  ensureVisibilityListener();
  const entry = ensureEntry(runId);
  entry.onTick = onTick;
  if (entry.timer) return;
  recordHeartbeat(runId);
  const intervalMs = heartbeatConfig.heartbeatIntervalMs;
  if (intervalMs <= 0) return;
  entry.timer = setInterval(() => {
    recordHeartbeat(runId);
    entry.onTick?.();
  }, intervalMs);
}

/** Stop heartbeat ticks for a run (on settle or stream end). */
export function stopHeartbeat(runId: string): void {
  const entry = entries.get(runId);
  if (!entry) return;
  if (entry.timer) {
    clearInterval(entry.timer);
    entry.timer = null;
  }
}

/** Ms since the last heartbeat tick; null when no tick yet. */
export function getHeartbeatAgeMs(runId: string): number | null {
  const entry = entries.get(runId);
  if (!entry || entry.target.lastHeartbeatAt == null) return null;
  return monotonicDelta() - entry.target.lastHeartbeatAt;
}

/** Ms since the last progress bump; null when no bump yet. */
export function getProgressAgeMs(runId: string): number | null {
  const entry = entries.get(runId);
  if (!entry || entry.target.lastProgressAt == null) return null;
  return monotonicDelta() - entry.target.lastProgressAt;
}

/** Human-readable heartbeat badge for task cards (observe-only). */
export function formatHeartbeatBadge(
  supervision: RunSupervision,
  config: HeartbeatConfig = heartbeatConfig,
): string | null {
  if (supervision.lastHeartbeatAt == null) return null;
  const ageMs = monotonicDelta() - supervision.lastHeartbeatAt;
  const ageSec = Math.max(0, Math.round(ageMs / 1000));
  const stale = ageMs > config.heartbeatDeadMs;
  const heart = stale ? `stale ${ageSec}s` : `♥ ${ageSec}s`;
  if (supervision.progressSeq > 0) {
    return `${heart} · #${supervision.progressSeq}`;
  }
  return heart;
}

/** Fire the stored heartbeat onTick for a run (tests only). */
export function tickHeartbeatForTests(runId: string): void {
  entries.get(runId)?.onTick?.();
}

/** Clear all supervision state (tests). */
export function resetWrapperState(): void {
  for (const entry of entries.values()) {
    if (entry.timer) clearInterval(entry.timer);
  }
  entries.clear();
  heartbeatConfig = { ...DEFAULT_HEARTBEAT_CONFIG };
  visibilityBaseline = performance.now();
  pageHiddenAtMono = null;
}
