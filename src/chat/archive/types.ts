/**
 * Archive policy types — Brain-backed context token reduction (MIN-139).
 */

import type { ApiMessage } from '../../types';

/** Per-agent archive tuning when contextEnforcementPolicy is `archive`. */
export interface ArchiveConfig {
  /** Archive turns older than this many user turns from the latest (default 20). */
  stalenessTurns: number;
  /** Also archive when estimated fill >= this fraction of the context limit (default 0.75). */
  pressureThreshold: number;
  /** Hard floor: never archive the most recent N turns (default 4). */
  minRecentTurns: number;
  /** Facts injected by auto-prelude / recall tools (default 5). */
  retrievalTopK: number;
  /** Optional embedding model override; else Brain engine default. */
  embeddingModelId?: string;
  /** When true, reorder retrieve hits with a small LLM pass (default off). */
  llmRerank?: boolean;
}

export const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig = {
  stalenessTurns: 20,
  pressureThreshold: 0.75,
  minRecentTurns: 4,
  retrievalTopK: 8,
  llmRerank: false,
};

/** Clamp archive numeric fields (mirrors server/config/validators.js). */
export function normalizeArchiveConfig(
  raw: Partial<ArchiveConfig> | undefined,
): ArchiveConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Partial<ArchiveConfig> = {};
  const staleness = Number(raw.stalenessTurns);
  if (Number.isFinite(staleness)) {
    out.stalenessTurns = Math.min(200, Math.max(1, Math.floor(staleness)));
  }
  const pressure = Number(raw.pressureThreshold);
  if (Number.isFinite(pressure)) {
    out.pressureThreshold = Math.min(0.99, Math.max(0.1, pressure));
  }
  const minRecent = Number(raw.minRecentTurns);
  if (Number.isFinite(minRecent)) {
    out.minRecentTurns = Math.min(50, Math.max(1, Math.floor(minRecent)));
  }
  const topK = Number(raw.retrievalTopK);
  if (Number.isFinite(topK)) {
    out.retrievalTopK = Math.min(20, Math.max(1, Math.floor(topK)));
  }
  if (typeof raw.embeddingModelId === 'string' && raw.embeddingModelId.trim()) {
    out.embeddingModelId = raw.embeddingModelId.trim().slice(0, 128);
  }
  if (typeof raw.llmRerank === 'boolean') {
    out.llmRerank = raw.llmRerank;
  }
  return Object.keys(out).length ? { ...DEFAULT_ARCHIVE_CONFIG, ...out } : undefined;
}

/** Archive retrieve scope — chat-scoped by default; workspace is opt-in via tool. */
export type ArchiveRetrieveScope =
  | { chatId: string }
  | { mode: 'workspace' };

/** One contiguous history span selected for archival. */
export interface ArchiveHistoryRange {
  /** Inclusive start index in chat.history. */
  startIndex: number;
  /** Exclusive end index in chat.history. */
  endIndex: number;
  /** Every history index included in this bundle. */
  sourceTurnIndices: number[];
}

/** Parsed fact from an archive bundle (client or server). */
export interface ArchiveFact {
  statement: string;
  sourceQuote: string;
  sourceTurnIndex: number;
}

/** Entity stub referenced from an archive page. */
export interface ArchiveEntity {
  slug: string;
  title: string;
  kind?: string;
}

/** LLM or extractive bundler output before write. */
export interface ArchiveBundlePayload {
  title: string;
  facts: ArchiveFact[];
  entities: ArchiveEntity[];
  body?: string;
}

/** Input for POST /api/brain/archive. */
export interface ArchiveBundleRequest {
  chatId: string;
  workspaceKey: string;
  turns: ApiMessage[];
  sourceTurnIndices: number[];
  /** When true, skip LLM and use deterministic extractive bundling (tests). */
  extractiveOnly?: boolean;
}

/** One retrieve hit from scoped Brain archive recall. */
export interface ArchiveRecallHit {
  path: string;
  title: string;
  excerpt: string;
  sourceQuote?: string;
  backlinks?: string[];
}

/** Result of applyArchivePolicy pre-pass. */
export interface ArchivePreResult {
  messages: ApiMessage[];
  /** User turns collapsed this send. */
  archived: number;
  /** Facts injected into auto-prelude. */
  recalled: number;
  recallTokens: number;
  /** Ranges collapsed — reused across tool turns in one send. */
  collapsedRanges: ArchiveHistoryRange[];
  /** Serialized retrieved_context block (constant within a send). */
  retrievedBlock?: string;
}
