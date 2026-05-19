/**
 * Resolve expert for a chat turn: manual selection vs auto routing.
 */

import type {
  ExpertRecord,
  ExpertRouteResult,
  ExpertSelection,
  ExpertsConfig,
} from './types';
import { routeExpertByRules } from './rules-router';

export interface ResolveExpertInput {
  selection: ExpertSelection;
  userText: string;
  registry: ExpertRecord[];
  config: ExpertsConfig;
}

/**
 * Resolve which expert applies this turn (manual wins; auto uses rules + optional LLM elsewhere).
 */
export function resolveExpertForTurn(input: ResolveExpertInput): ExpertRouteResult {
  const { selection, userText, registry, config } = input;

  if (!config.enabled) {
    return { expertId: null, source: 'none', confidence: 0 };
  }

  if (selection.mode === 'manual' && selection.expertId) {
    const manual = registry.find((r) => r.meta.id === selection.expertId);
    if (manual) {
      return {
        expertId: manual.meta.id,
        source: 'manual',
        confidence: 1,
        label: manual.meta.label,
      };
    }
    const general = registry.find((r) => r.meta.id === 'general');
    if (general) {
      return {
        expertId: general.meta.id,
        source: 'manual',
        confidence: 1,
        label: general.meta.label,
      };
    }
    return { expertId: null, source: 'none', confidence: 0 };
  }

  const rulesResult = routeExpertByRules(userText, registry, {
    minScore: config.rulesMinScore,
    autoOmitWhenNoMatch: config.autoOmitWhenNoMatch,
  });

  return rulesResult;
}

/**
 * Whether LLM classifier should run after rules (caller runs async classify).
 */
export function shouldRunLlmClassifier(
  rulesResult: ExpertRouteResult,
  config: ExpertsConfig,
): boolean {
  if (!config.enabled) return false;
  const mode = config.classifier;
  if (mode !== 'llm' && mode !== 'rules+llm') return false;
  return rulesResult.confidence < config.llmFallbackBelow;
}
