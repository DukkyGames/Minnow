/**
 * Global orchestrator autopilot defaults in ~/.minnow/config.json (`autopilot` block).
 * Per-board overrides live on {@link OrchestrateBoardState}; resolution is
 * per-board ?? global ?? hard-coded fallback.
 */

import {
  clampHeartbeatDeadMs,
  clampHeartbeatIntervalMs,
  clampProgressStallMs,
} from '../agents/sub-agent-config';
import { detectConfigServer } from './storage-mode';

export type AutopilotExecutionMode = 'manual' | 'sequential' | 'auto' | 'afk';

/** Stored isolation sentinel `auto` means derive from execution mode at resolve time. */
export type AutopilotIsolationMode = 'auto' | 'off' | 'per-task' | 'per-wave';

export type AutopilotContinueSmartRoute = 'off' | 'conservative' | 'aggressive';

/** Persisted global autopilot defaults for orchestrate boards. */
export interface AutopilotMeta {
  defaultExecutionMode: AutopilotExecutionMode;
  maxConcurrentTasks: number;
  isolationMode: AutopilotIsolationMode;
  maxTestAttempts: number;
  maxBuildAttempts: number;
  maxFinalTestAttempts: number;
  /** When Continue should auto-route to a fresh summarized chat instead of nudging. */
  continueSmartRoute: AutopilotContinueSmartRoute;
  heartbeatIntervalMs: number;
  progressStallMs: number;
  heartbeatDeadMs: number;
  plannerProviderId: string;
  plannerModelId: string;
}

const FALLBACK_MAX_CONCURRENT = 3;
const FALLBACK_MAX_TEST_ATTEMPTS = 3;
const FALLBACK_MAX_BUILD_ATTEMPTS = 2;
const FALLBACK_MAX_FINAL_TEST_ATTEMPTS = 3;

export const DEFAULT_AUTOPILOT_META: AutopilotMeta = {
  defaultExecutionMode: 'manual',
  maxConcurrentTasks: FALLBACK_MAX_CONCURRENT,
  isolationMode: 'auto',
  maxTestAttempts: FALLBACK_MAX_TEST_ATTEMPTS,
  maxBuildAttempts: FALLBACK_MAX_BUILD_ATTEMPTS,
  maxFinalTestAttempts: FALLBACK_MAX_FINAL_TEST_ATTEMPTS,
  continueSmartRoute: 'conservative',
  heartbeatIntervalMs: 7_000,
  progressStallMs: 90_000,
  heartbeatDeadMs: 30_000,
  plannerProviderId: '',
  plannerModelId: '',
};

const AUTOPILOT_META_STORAGE_KEY = 'minnow.autopilotMeta';

const EXECUTION_MODES = new Set<AutopilotExecutionMode>([
  'manual',
  'sequential',
  'auto',
  'afk',
]);

const ISOLATION_MODES = new Set<AutopilotIsolationMode>([
  'auto',
  'off',
  'per-task',
  'per-wave',
]);

const CONTINUE_SMART_ROUTE_MODES = new Set<AutopilotContinueSmartRoute>([
  'off',
  'conservative',
  'aggressive',
]);

let cachedAutopilot: AutopilotMeta | null = null;

function clampConcurrency(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(1, Math.round(n)));
}

function clampAttempts(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function parseExecutionMode(value: unknown): AutopilotExecutionMode {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (EXECUTION_MODES.has(raw as AutopilotExecutionMode)) {
    return raw as AutopilotExecutionMode;
  }
  return DEFAULT_AUTOPILOT_META.defaultExecutionMode;
}

function parseIsolationMode(value: unknown): AutopilotIsolationMode {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (ISOLATION_MODES.has(raw as AutopilotIsolationMode)) {
    return raw as AutopilotIsolationMode;
  }
  return DEFAULT_AUTOPILOT_META.isolationMode;
}

export function parseContinueSmartRoute(value: unknown): AutopilotContinueSmartRoute {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (CONTINUE_SMART_ROUTE_MODES.has(raw as AutopilotContinueSmartRoute)) {
    return raw as AutopilotContinueSmartRoute;
  }
  return DEFAULT_AUTOPILOT_META.continueSmartRoute;
}

function parseStringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Merge persisted `autopilot` with shipped defaults and clamps. */
export function parseAutopilotMeta(raw: unknown): AutopilotMeta {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_AUTOPILOT_META };
  }
  const block = raw as Record<string, unknown>;
  return {
    defaultExecutionMode: parseExecutionMode(block.defaultExecutionMode),
    maxConcurrentTasks: clampConcurrency(
      block.maxConcurrentTasks,
      DEFAULT_AUTOPILOT_META.maxConcurrentTasks,
    ),
    isolationMode: parseIsolationMode(block.isolationMode),
    maxTestAttempts: clampAttempts(
      block.maxTestAttempts,
      DEFAULT_AUTOPILOT_META.maxTestAttempts,
    ),
    maxBuildAttempts: clampAttempts(
      block.maxBuildAttempts,
      DEFAULT_AUTOPILOT_META.maxBuildAttempts,
    ),
    maxFinalTestAttempts: clampAttempts(
      block.maxFinalTestAttempts,
      DEFAULT_AUTOPILOT_META.maxFinalTestAttempts,
    ),
    continueSmartRoute: parseContinueSmartRoute(block.continueSmartRoute),
    heartbeatIntervalMs: clampHeartbeatIntervalMs(
      block.heartbeatIntervalMs,
      DEFAULT_AUTOPILOT_META.heartbeatIntervalMs,
    ),
    progressStallMs: clampProgressStallMs(
      block.progressStallMs,
      DEFAULT_AUTOPILOT_META.progressStallMs,
    ),
    heartbeatDeadMs: clampHeartbeatDeadMs(
      block.heartbeatDeadMs,
      DEFAULT_AUTOPILOT_META.heartbeatDeadMs,
    ),
    plannerProviderId: parseStringField(block.plannerProviderId),
    plannerModelId: parseStringField(block.plannerModelId),
  };
}

function readLocalAutopilotMeta(): AutopilotMeta {
  try {
    const raw = localStorage.getItem(AUTOPILOT_META_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTOPILOT_META };
    return parseAutopilotMeta(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUTOPILOT_META };
  }
}

function writeLocalAutopilotMeta(config: AutopilotMeta): void {
  localStorage.setItem(AUTOPILOT_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchAutopilotFromServer(): Promise<AutopilotMeta> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalAutopilotMeta();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseAutopilotMeta(meta.autopilot);
}

/** Load global autopilot meta (cached until reset). */
export async function loadAutopilotMeta(): Promise<AutopilotMeta> {
  if (cachedAutopilot) {
    return parseAutopilotMeta(cachedAutopilot);
  }

  const serverUp = await detectConfigServer();
  cachedAutopilot = serverUp
    ? await fetchAutopilotFromServer()
    : readLocalAutopilotMeta();
  writeLocalAutopilotMeta(cachedAutopilot);
  return cachedAutopilot;
}

/** Last loaded value or localStorage fallback before first async load. */
export function getAutopilotMetaSync(): AutopilotMeta {
  return parseAutopilotMeta(cachedAutopilot ?? readLocalAutopilotMeta());
}

/** Clear cache (tests). */
export function resetAutopilotMetaCache(): void {
  cachedAutopilot = null;
}

/** Override cache for tests (no localStorage). */
export function setAutopilotMetaForTests(config: Partial<AutopilotMeta>): void {
  cachedAutopilot = parseAutopilotMeta({
    ...DEFAULT_AUTOPILOT_META,
    ...config,
  });
}

/** Global per-task test-failure threshold (no per-board override). */
export function resolveMaxTaskTestAttempts(): number {
  return getAutopilotMetaSync().maxTestAttempts ?? FALLBACK_MAX_TEST_ATTEMPTS;
}

/** Global per-task build-failure threshold (no per-board override). */
export function resolveMaxTaskBuildAttempts(): number {
  return getAutopilotMetaSync().maxBuildAttempts ?? FALLBACK_MAX_BUILD_ATTEMPTS;
}

/** Global final integration test threshold (no per-board override). */
export function resolveMaxFinalTestAttempts(): number {
  return getAutopilotMetaSync().maxFinalTestAttempts ?? FALLBACK_MAX_FINAL_TEST_ATTEMPTS;
}

/** Persist partial global autopilot via PUT /api/config/meta and mirror locally. */
export async function saveAutopilotMeta(
  patch: Partial<AutopilotMeta>,
): Promise<AutopilotMeta> {
  const current = await loadAutopilotMeta();
  const merged = parseAutopilotMeta({ ...current, ...patch });

  cachedAutopilot = merged;
  writeLocalAutopilotMeta(merged);

  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autopilot: merged }),
  });

  return merged;
}
