/**
 * Eval harness config client (~/.minnow/evals/config.json).
 */

import type { EvalConfig } from './types';

export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  version: 1,
  maxConcurrency: 2,
  graderProviderId: '',
  graderModelId: '',
  graderTimeoutMs: 30_000,
  saveFullTranscripts: false,
  skipApprovalDuringEval: false,
};

function clampConcurrency(value: number): number {
  return Math.max(1, Math.min(8, Math.floor(value)));
}

/** Normalize partial config from disk or API. */
export function normalizeEvalConfig(raw: unknown): EvalConfig {
  const base = { ...DEFAULT_EVAL_CONFIG };
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  if (typeof r.version === 'number') base.version = Math.max(1, Math.floor(r.version));
  if (typeof r.maxConcurrency === 'number') {
    base.maxConcurrency = clampConcurrency(r.maxConcurrency);
  }
  if (typeof r.graderProviderId === 'string') {
    base.graderProviderId = r.graderProviderId.trim();
  }
  if (typeof r.graderModelId === 'string') {
    base.graderModelId = r.graderModelId.trim();
  }
  if (typeof r.graderTimeoutMs === 'number' && Number.isFinite(r.graderTimeoutMs)) {
    base.graderTimeoutMs = Math.max(5_000, Math.floor(r.graderTimeoutMs));
  }
  if (typeof r.saveFullTranscripts === 'boolean') {
    base.saveFullTranscripts = r.saveFullTranscripts;
  }
  if (typeof r.skipApprovalDuringEval === 'boolean') {
    base.skipApprovalDuringEval = r.skipApprovalDuringEval;
  }
  return base;
}

/** Fetch eval config from API; returns defaults when offline. */
export async function fetchEvalConfig(): Promise<EvalConfig> {
  try {
    const res = await fetch('/api/evals/config');
    if (!res.ok) return { ...DEFAULT_EVAL_CONFIG };
    const raw = await res.json();
    return normalizeEvalConfig(raw);
  } catch {
    return { ...DEFAULT_EVAL_CONFIG };
  }
}

/** Persist eval config via API. */
export async function saveEvalConfig(config: EvalConfig): Promise<boolean> {
  try {
    const res = await fetch('/api/evals/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch {
    return false;
  }
}
