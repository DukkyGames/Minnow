/**
 * Persisted PR reviews so Source Control and Issues can render the same result
 * after the review chat is no longer focused. Lives at ~/.minnow/reviews/state.json.
 */

import { isServerStorageMode } from '../config/storage-mode.ts';
import type { SubAgentArtifact, SubAgentFinding } from '../agents/sub-agent-structured-outcome.ts';

const STORAGE_KEY = 'minnow-reviews-v1';
const SAVE_DEBOUNCE_MS = 400;

export type PrReviewStatus = 'running' | 'done' | 'failed';

export interface PrReviewRecord {
  key: string;
  repo: string;
  number: number;
  url: string;
  headRef: string;
  baseRef: string;
  /** SHA at review time — the panel uses this to flag a stale review. */
  headSha: string;
  issueId?: string;
  chatId: string;
  runId: string;
  status: PrReviewStatus;
  summary: string;
  findings: SubAgentFinding[];
  artifacts: SubAgentArtifact[];
  error?: string;
  startedAt: number;
  endedAt?: number;
}

interface ReviewsState {
  reviews: Record<string, PrReviewRecord>;
}

const listeners = new Set<() => void>();
let state: ReviewsState = { reviews: {} };
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** One review by `owner/name#n`. */
export function getPrReview(key: string): PrReviewRecord | undefined {
  return state.reviews[key];
}

/** Patch (or create) a review and persist. */
export function upsertPrReview(patch: Partial<PrReviewRecord> & { key: string }): PrReviewRecord {
  const prior = state.reviews[patch.key];
  const next: PrReviewRecord = {
    key: patch.key,
    repo: patch.repo ?? prior?.repo ?? '',
    number: patch.number ?? prior?.number ?? 0,
    url: patch.url ?? prior?.url ?? '',
    headRef: patch.headRef ?? prior?.headRef ?? '',
    baseRef: patch.baseRef ?? prior?.baseRef ?? '',
    headSha: patch.headSha ?? prior?.headSha ?? '',
    chatId: patch.chatId ?? prior?.chatId ?? '',
    runId: patch.runId ?? prior?.runId ?? '',
    status: patch.status ?? prior?.status ?? 'running',
    summary: patch.summary ?? prior?.summary ?? '',
    findings: patch.findings ?? prior?.findings ?? [],
    artifacts: patch.artifacts ?? prior?.artifacts ?? [],
    startedAt: patch.startedAt ?? prior?.startedAt ?? Date.now(),
  };
  if (patch.issueId !== undefined) next.issueId = patch.issueId;
  else if (prior?.issueId) next.issueId = prior.issueId;
  if (patch.error !== undefined) {
    if (patch.error) next.error = patch.error;
  } else if (prior?.error) {
    next.error = prior.error;
  }
  if (patch.endedAt !== undefined) next.endedAt = patch.endedAt;
  else if (prior?.endedAt) next.endedAt = prior.endedAt;

  state.reviews[next.key] = next;
  scheduleSavePrReviews();
  emitPrReviewsChange();
  return next;
}

/** Reviews linked to an issue (Issues detail Review section). */
export function listPrReviewsForIssue(issueId: string): PrReviewRecord[] {
  const wanted = issueId.trim();
  if (!wanted) return [];
  return Object.values(state.reviews).filter((row) => row.issueId === wanted);
}

/** Subscribe to store mutations. Returns unsubscribe. */
export function subscribePrReviews(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emitPrReviewsChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function scheduleSavePrReviews(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePrReviewsNow();
  }, SAVE_DEBOUNCE_MS);
}

async function savePrReviewsNow(): Promise<void> {
  if (isServerStorageMode()) {
    try {
      const { putReviews } = await import('../config/api-client.ts');
      await putReviews(state);
    } catch {
      void import('../ui/status.ts').then((m) =>
        m.setStatus('err', 'Could not save PR reviews to ~/.minnow'),
      );
    }
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

/** Load from ~/.minnow or localStorage. Safe to call more than once. */
export async function loadPrReviewsFromStorage(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (isServerStorageMode()) {
    try {
      const { getReviews } = await import('../config/api-client.ts');
      const remote = await getReviews();
      if (remote) state = normalizeReviewsState(remote);
    } catch {
      state = { reviews: {} };
    }
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = normalizeReviewsState(JSON.parse(raw) as unknown);
  } catch {
    state = { reviews: {} };
  }
}

/** Test helper: replace the in-memory map. */
export function resetPrReviewsForTests(next?: ReviewsState): void {
  loaded = true;
  state = next ?? { reviews: {} };
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  listeners.clear();
}

function normalizeReviewsState(raw: unknown): ReviewsState {
  if (!raw || typeof raw !== 'object') return { reviews: {} };
  const blob = raw as { reviews?: unknown };
  if (!blob.reviews || typeof blob.reviews !== 'object' || Array.isArray(blob.reviews)) {
    return { reviews: {} };
  }
  const reviews: Record<string, PrReviewRecord> = {};
  for (const [key, value] of Object.entries(blob.reviews as Record<string, unknown>)) {
    const row = normalizeRecord(key, value);
    if (row) reviews[row.key] = row;
  }
  return { reviews };
}

function normalizeRecord(key: string, value: unknown): PrReviewRecord | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<PrReviewRecord>;
  const number = typeof row.number === 'number' ? row.number : Number(row.number);
  if (!Number.isFinite(number) || number <= 0) return null;
  const status: PrReviewStatus =
    row.status === 'done' || row.status === 'failed' || row.status === 'running' ? row.status : 'failed';
  return {
    key: typeof row.key === 'string' && row.key.trim() ? row.key.trim() : key,
    repo: typeof row.repo === 'string' ? row.repo : '',
    number,
    url: typeof row.url === 'string' ? row.url : '',
    headRef: typeof row.headRef === 'string' ? row.headRef : '',
    baseRef: typeof row.baseRef === 'string' ? row.baseRef : '',
    headSha: typeof row.headSha === 'string' ? row.headSha : '',
    issueId: typeof row.issueId === 'string' && row.issueId.trim() ? row.issueId.trim() : undefined,
    chatId: typeof row.chatId === 'string' ? row.chatId : '',
    runId: typeof row.runId === 'string' ? row.runId : '',
    status,
    summary: typeof row.summary === 'string' ? row.summary : '',
    findings: Array.isArray(row.findings) ? row.findings : [],
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
    error: typeof row.error === 'string' && row.error.trim() ? row.error : undefined,
    startedAt: typeof row.startedAt === 'number' ? row.startedAt : Date.now(),
    endedAt: typeof row.endedAt === 'number' ? row.endedAt : undefined,
  };
}
