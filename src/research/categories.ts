/**
 * Deep Research category labels and legacy normalization (client-side).
 */

import type { ResearchCategory } from './types';

const LEGACY_ALIASES: Record<string, ResearchCategory> = {
  product: 'technical',
  comparison: 'market',
  howto: 'technical',
  factcheck: 'news',
};

const LABELS: Record<string, string> = {
  technical: 'Technical',
  academic: 'Academic',
  news: 'News',
  market: 'Market',
  general: 'General',
};

/** Normalize persisted or legacy category strings for display. */
export function normalizeResearchCategory(category?: string | null): ResearchCategory | '' {
  const raw = String(category ?? '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  if (raw in LEGACY_ALIASES) {
    return LEGACY_ALIASES[raw];
  }
  if (raw in LABELS) {
    return raw as ResearchCategory;
  }
  return 'general';
}

/** Human-readable category tag for library cards. */
export function researchCategoryLabel(category?: string | null): string {
  const norm = normalizeResearchCategory(category);
  if (!norm) {
    return 'General';
  }
  return LABELS[norm] ?? norm.charAt(0).toUpperCase() + norm.slice(1);
}
