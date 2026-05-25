/**
 * Merge built-in and user eval packs (user overrides built-in by id).
 */

import type { EvalPack, EvalPackListItem } from './types';

/** Merge pack catalogs; user wins on duplicate id; sort by label. */
export function mergeEvalPackLists(
  builtin: EvalPackListItem[],
  user: EvalPackListItem[],
): EvalPackListItem[] {
  const byId = new Map<string, EvalPackListItem>();
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

/** Resolve full pack by id; user overrides built-in. */
export function resolveEvalPack(
  id: string,
  builtinPacks: EvalPack[],
  userPacks: EvalPack[],
): EvalPack | null {
  const user = userPacks.find((p) => p.id === id);
  if (user) return user;
  return builtinPacks.find((p) => p.id === id) ?? null;
}

/** List item from a full pack. */
export function evalPackToListItem(pack: EvalPack): EvalPackListItem {
  return {
    id: pack.id,
    label: pack.label,
    version: pack.version,
    taskCount: pack.tasks.length,
    source: pack.source ?? 'builtin',
  };
}
