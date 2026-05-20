/**
 * Pure skill list merge and detail resolution (unit-tested).
 */

import type { SkillDetail, SkillListItem } from './types';

/** Merge catalogs; user entry wins on duplicate id; sort by label. */
export function mergeSkillLists(
  builtin: SkillListItem[],
  user: SkillListItem[],
): SkillListItem[] {
  const byId = new Map<string, SkillListItem>();
  for (const item of builtin) {
    byId.set(item.id, item);
  }
  for (const item of user) {
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
}

/** Resolve detail by id; user overrides built-in. */
export function resolveSkillDetail(
  id: string,
  builtinDetails: SkillDetail[],
  userDetails: SkillDetail[],
): SkillDetail | null {
  const user = userDetails.find((s) => s.id === id);
  if (user) return user;
  return builtinDetails.find((s) => s.id === id) ?? null;
}
