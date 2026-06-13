/**
 * Catalog entries for standard + integration tests (Tests tab browser).
 */

import { listExpectedTestsForSuites, resolveTestDescription } from '../test-catalog.ts';
import type { SuiteId } from '../types.ts';
import { listBuiltinStandardPacks } from './pack-loader.ts';
import type { StandardCatalogEntry } from './types.ts';

export interface UnifiedCatalogEntry {
  id: string;
  label: string;
  family: 'integration' | 'standard' | 'custom';
  category: string;
  purpose: string;
  method: string;
  passCriteria: string;
  promptPreview: string;
  tier?: string;
  packId?: string;
}

const INTEGRATION_SUITE_CATEGORIES: Record<SuiteId, string> = {
  capability: 'integration',
  speed: 'integration',
  tools: 'integration',
  skills: 'integration',
  coding: 'integration',
};

export function listIntegrationCatalogEntries(
  suiteIds: SuiteId[],
): UnifiedCatalogEntry[] {
  const expected = listExpectedTestsForSuites(suiteIds);
  return expected.map((row) => {
    const desc = resolveTestDescription(row.testId, row.suite, row.label);
    return {
      id: row.testId,
      label: row.label,
      family: 'integration',
      category: INTEGRATION_SUITE_CATEGORIES[row.suite],
      purpose: desc?.purpose ?? 'Integration probe',
      method: desc?.method ?? '',
      passCriteria: desc?.passCriteria ?? '',
      promptPreview: desc?.purpose ?? row.label,
    };
  });
}

export function listStandardCatalogEntries(): StandardCatalogEntry[] {
  return listBuiltinStandardPacks().map((pack) => ({
    packId: pack.id,
    label: pack.label,
    family: 'standard',
    category: pack.category,
    purpose: pack.description,
    method: 'Single-turn completion against ground truth',
    passCriteria:
      pack.scoring === 'mcq'
        ? 'Correct multiple-choice letter'
        : pack.scoring === 'numeric'
          ? '#### numeric answer matches ground truth'
          : pack.scoring === 'code'
            ? 'Python unit tests via check()'
            : pack.id === 'truthfulqa-mini'
              ? 'Response matches truthfulness regex (lightweight proxy, not paper generative metric)'
              : 'Response matches truthfulness pattern',
    tier: 'mini',
    itemCount: pack.miniCount,
    promptPreview: pack.items[0]?.prompt.slice(0, 120) ?? '',
  }));
}

export function standardToUnified(entries: StandardCatalogEntry[]): UnifiedCatalogEntry[] {
  return entries.map((e) => ({
    id: e.packId,
    label: e.label,
    family: 'standard',
    category: e.category,
    purpose: e.purpose,
    method: e.method,
    passCriteria: e.passCriteria,
    promptPreview: e.promptPreview,
    tier: e.tier,
    packId: e.packId,
  }));
}
