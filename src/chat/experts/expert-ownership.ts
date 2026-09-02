import type { ExpertRecord } from './types';

/** True when the id exists in the shipped built-in registry. */
export function isBuiltinExpertId(id: string, builtinIds: ReadonlySet<string>): boolean {
  return builtinIds.has(id);
}

/** User-created experts under ~/.minnow only (not built-in overrides). */
export function isUserOwnedExpert(
  record: ExpertRecord | null | undefined,
  builtinIds: ReadonlySet<string>,
): boolean {
  if (!record || record.source !== 'user') return false;
  return !isBuiltinExpertId(record.meta.id, builtinIds);
}
