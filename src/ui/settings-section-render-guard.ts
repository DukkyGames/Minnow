/**
 * Guards async settings section renders against stale navigation (MIN-130).
 */

import type { SettingsSectionId } from './settings-page-types';

const asyncSectionRenderGeneration: Partial<Record<SettingsSectionId, number>> = {};

/** Bump render generation when a section starts loading (call before awaits). */
export function beginAsyncSectionRender(section: SettingsSectionId): number {
  const next = (asyncSectionRenderGeneration[section] ?? 0) + 1;
  asyncSectionRenderGeneration[section] = next;
  return next;
}

/** True when the user navigated away or triggered a newer render for this section. */
export function isAsyncSectionRenderStale(
  section: SettingsSectionId,
  generation: number,
): boolean {
  return asyncSectionRenderGeneration[section] !== generation;
}
