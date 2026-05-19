/**
 * Expert system types: metadata, selection, routing results, and config.
 */

/** Machine-readable expert metadata (front matter or meta.json). */
export interface ExpertTriggers {
  keywords?: string[];
  regex?: string[];
  negativeKeywords?: string[];
}

export interface ExpertMeta {
  id: string;
  label: string;
  kind: 'expert';
  version: string;
  description?: string;
  priority?: number;
  triggers?: ExpertTriggers;
  classifierHint?: string;
  /** Fallback when Auto has no strong rules match. */
  default?: boolean;
}

/** Loaded expert with full/lite bodies for routing and composer. */
export interface ExpertRecord {
  meta: ExpertMeta;
  fullBody: string;
  liteBody?: string;
  source: 'builtin' | 'user';
}

export type ExpertSelectionMode = 'auto' | 'manual';

export interface ExpertSelection {
  mode: ExpertSelectionMode;
  /** Set when mode === 'manual'; ignored for routing when mode === 'auto'. */
  expertId: string | null;
}

export type ExpertRouteSource = 'manual' | 'rules' | 'llm' | 'default' | 'none';

export interface ExpertRouteResult {
  expertId: string | null;
  source: ExpertRouteSource;
  /** 0..1 for rules/llm; 1 for manual/default when applied. */
  confidence: number;
  label?: string;
}

export type ExpertClassifierMode = 'rules' | 'llm' | 'rules+llm';

export interface ExpertClassifierModelRef {
  providerId: string;
  modelId: string;
}

/** `experts` block in ~/.speedchat/config.json. */
export interface ExpertsConfig {
  enabled: boolean;
  classifier: ExpertClassifierMode;
  llmFallbackBelow: number;
  rulesMinScore: number;
  autoOmitWhenNoMatch: boolean;
  classifierModel?: ExpertClassifierModelRef;
}

export const DEFAULT_EXPERTS_CONFIG: ExpertsConfig = {
  enabled: true,
  classifier: 'rules',
  llmFallbackBelow: 0.55,
  rulesMinScore: 3,
  autoOmitWhenNoMatch: false,
};
