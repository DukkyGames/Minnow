/**
 * Stable slug for task×model cell filenames.
 */

/** Build filesystem-safe model key from provider + model ids. */
export function buildModelKey(providerId: string, modelId: string): string {
  const raw = `${providerId.trim()}__${modelId.trim()}`;
  return raw.replace(/\//g, '_').replace(/\\/g, '_');
}

/** Cell artifact id: taskId__modelKey */
export function buildCellId(taskId: string, modelKey: string): string {
  return `${taskId}__${modelKey}`;
}
