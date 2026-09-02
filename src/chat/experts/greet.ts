import type { ExpertMeta } from './types';

/** Deterministic fallback when no authored greeting exists. */
export function fallbackGreeting(label: string, description?: string): string {
  const desc = description?.trim();
  if (desc) {
    return `Hi — I'm **${label}**. ${desc}\n\nWhat would you like to work on?`;
  }
  return `Hi — I'm **${label}**. What would you like to work on?`;
}

/** Resolve the opening message from expert metadata (synchronous, no model call). */
export function resolveAuthoredGreeting(meta: ExpertMeta): string {
  const authored = meta.greeting?.trim();
  if (authored) return authored;
  return fallbackGreeting(meta.label, meta.description);
}
