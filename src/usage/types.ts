/**
 * Token ledger and provider pricing types (Feature #14).
 */

import type { Stats, Usage } from '../types';

/** Per-million-token rates for a model or wildcard. */
export interface ModelPricingRates {
  inputPer1M: number;
  outputPer1M: number;
}

/** Provider profile pricing block (persisted server-side). */
export interface ProviderPricing {
  currency?: string;
  default?: ModelPricingRates;
  models?: Record<string, ModelPricingRates>;
}

/** Who initiated the completion (for rollups). */
export type TokenLedgerSource =
  | { kind: 'main'; modeId: string; workAgentId?: string | null }
  | { kind: 'sub-agent'; subAgentType: string; runId: string }
  | { kind: 'title' }
  | { kind: 'reef-widget' }
  | { kind: 'orchestrate-board' }
  | { kind: 'work-agent'; workAgentId: string };

export interface TokenLedgerEntry {
  id: string;
  at: number;
  source: TokenLedgerSource;
  providerId: string;
  modelId: string;
  usage: Usage;
  stats?: Stats;
  costUsd: number | null;
}

export interface TokenLedgerTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  completionCount: number;
}

/** Keys: stable string from source, e.g. "main:build", "sub-agent:explore". */
export type TokenLedgerBySource = Record<string, TokenLedgerTotals>;

export interface ChatTokenLedger {
  entries: TokenLedgerEntry[];
  totals: TokenLedgerTotals;
  bySource: TokenLedgerBySource;
}

/** Max retained ledger rows per chat (totals always accumulate). */
export const TOKEN_LEDGER_ENTRY_CAP = 200;
