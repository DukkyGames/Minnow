/**
 * Rules-based expert router: keyword/regex scoring with negatives and priority.
 */

import type { ExpertMeta, ExpertRecord, ExpertRouteResult } from './types';

export interface RulesRouterOptions {
  minScore: number;
  autoOmitWhenNoMatch: boolean;
  /** When true, keyword matches require word boundaries. */
  wholeWord?: boolean;
}

const DEFAULT_OPTIONS: RulesRouterOptions = {
  minScore: 3,
  autoOmitWhenNoMatch: false,
  wholeWord: false,
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function keywordMatches(text: string, keyword: string, wholeWord: boolean): boolean {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  if (!wholeWord) return text.includes(kw);
  const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(text);
}

function scoreExpert(
  text: string,
  meta: ExpertMeta,
  wholeWord: boolean,
): number {
  let score = 0;
  const triggers = meta.triggers;
  if (!triggers) return score;

  for (const kw of triggers.keywords ?? []) {
    if (keywordMatches(text, kw, wholeWord)) score += 2;
  }

  const regexList = (triggers.regex ?? []).slice(0, 3);
  for (const pattern of regexList) {
    try {
      const re = new RegExp(pattern, 'i');
      if (re.test(text)) score += 5;
    } catch {
      /* skip invalid regex */
    }
  }

  for (const neg of triggers.negativeKeywords ?? []) {
    if (keywordMatches(text, neg, wholeWord)) score -= 10;
  }

  return score;
}

function confidenceFromScore(score: number, minScore: number): number {
  if (score < minScore) return 0;
  return Math.min(1, 0.4 + (score - minScore) * 0.1);
}

/**
 * Pick the best expert for user text using keyword/regex rules.
 */
export function routeExpertByRules(
  userText: string,
  registry: ExpertRecord[],
  options?: Partial<RulesRouterOptions>,
): ExpertRouteResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const text = normalizeText(userText);

  if (!text) {
    return pickDefault(registry, opts);
  }

  const scored = registry
    .filter((r) => r.meta.kind === 'expert' && !r.meta.id.startsWith('_'))
    .map((record) => ({
      record,
      score: scoreExpert(text, record.meta, opts.wholeWord ?? false),
    }))
    .filter((row) => row.score >= opts.minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const pa = a.record.meta.priority ?? 0;
      const pb = b.record.meta.priority ?? 0;
      if (pb !== pa) return pb - pa;
      return a.record.meta.id.localeCompare(b.record.meta.id);
    });

  if (scored.length > 0) {
    const winner = scored[0].record;
    return {
      expertId: winner.meta.id,
      source: 'rules',
      confidence: confidenceFromScore(scored[0].score, opts.minScore),
      label: winner.meta.label,
    };
  }

  return pickDefault(registry, opts);
}

function pickDefault(
  registry: ExpertRecord[],
  opts: RulesRouterOptions,
): ExpertRouteResult {
  const fallback =
    registry.find((r) => r.meta.default) ??
    registry.find((r) => r.meta.id === 'general');

  if (fallback) {
    return {
      expertId: fallback.meta.id,
      source: 'default',
      confidence: 0.5,
      label: fallback.meta.label,
    };
  }

  if (opts.autoOmitWhenNoMatch) {
    return { expertId: null, source: 'none', confidence: 0 };
  }

  return { expertId: null, source: 'none', confidence: 0 };
}
