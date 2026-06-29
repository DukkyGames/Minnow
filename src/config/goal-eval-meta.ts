/**
 * Goal evaluator model settings from config.json meta (/goal loop judge).
 */

import { detectConfigServer } from './storage-mode';

export interface GoalEvalConfig {
  modelId: string;
  providerId: string;
  maxTokens: number;
  temperature: number;
}

const GOAL_EVAL_META_STORAGE_KEY = 'minnow.goalEvalMeta';

export const DEFAULT_GOAL_EVAL_CONFIG: GoalEvalConfig = {
  modelId: '',
  providerId: '',
  maxTokens: 256,
  temperature: 0.1,
};

let cachedGoalEval: GoalEvalConfig | null = null;

function clampMaxTokens(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GOAL_EVAL_CONFIG.maxTokens;
  return Math.min(512, Math.max(64, Math.round(n)));
}

function clampTemperature(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GOAL_EVAL_CONFIG.temperature;
  return Math.min(0.3, Math.max(0, n));
}

function parseGoalEvalBlock(raw: unknown): GoalEvalConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GOAL_EVAL_CONFIG };
  }
  const block = raw as Record<string, unknown>;
  return {
    modelId: typeof block.modelId === 'string' ? block.modelId : '',
    providerId: typeof block.providerId === 'string' ? block.providerId : '',
    maxTokens: clampMaxTokens(block.maxTokens),
    temperature: clampTemperature(block.temperature),
  };
}

function readLocalGoalEvalConfig(): GoalEvalConfig {
  try {
    const raw = localStorage.getItem(GOAL_EVAL_META_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GOAL_EVAL_CONFIG };
    return parseGoalEvalBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GOAL_EVAL_CONFIG };
  }
}

function writeLocalGoalEvalConfig(config: GoalEvalConfig): void {
  localStorage.setItem(GOAL_EVAL_META_STORAGE_KEY, JSON.stringify(config));
}

async function fetchGoalEvalFromServer(): Promise<GoalEvalConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocalGoalEvalConfig();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseGoalEvalBlock(meta.goalEval);
}

/** Load goal evaluator config (cached until reset). */
export async function loadGoalEvalConfig(): Promise<GoalEvalConfig> {
  if (cachedGoalEval) return cachedGoalEval;

  const serverUp = await detectConfigServer();
  cachedGoalEval = serverUp ? await fetchGoalEvalFromServer() : readLocalGoalEvalConfig();
  writeLocalGoalEvalConfig(cachedGoalEval);
  return cachedGoalEval;
}

/** Synchronous read of last loaded or local fallback. */
export function getGoalEvalConfigSync(): GoalEvalConfig {
  return cachedGoalEval ?? readLocalGoalEvalConfig();
}

/** Clear cache (tests). */
export function resetGoalEvalConfigCache(): void {
  cachedGoalEval = null;
}

/** Override cache for tests (no localStorage). */
export function setGoalEvalConfigForTests(config: GoalEvalConfig): void {
  cachedGoalEval = config;
}

/** Persist partial goal evaluator config via PUT /api/config/meta. */
export async function saveGoalEvalConfig(patch: Partial<GoalEvalConfig>): Promise<void> {
  const current = await loadGoalEvalConfig();
  const next: GoalEvalConfig = {
    modelId: patch.modelId !== undefined ? patch.modelId : current.modelId,
    providerId: patch.providerId !== undefined ? patch.providerId : current.providerId,
    maxTokens:
      patch.maxTokens !== undefined ? clampMaxTokens(patch.maxTokens) : current.maxTokens,
    temperature:
      patch.temperature !== undefined
        ? clampTemperature(patch.temperature)
        : current.temperature,
  };
  cachedGoalEval = next;
  writeLocalGoalEvalConfig(next);
  await fetch('/api/config/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goalEval: next }),
  });
}
