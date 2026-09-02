/**
 * Survives SPA reload: points the Research app at an in-flight server run.
 */

const STORAGE_KEY = 'minnow.research.activeRunId';

/** Remember which run the client should reattach to after reload. */
export function persistActiveResearchRunId(researchId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, researchId);
  } catch {}
}

/** Last persisted in-flight run id, if any. */
export function readPersistedActiveResearchRunId(): string | null {
  try {
    const id = sessionStorage.getItem(STORAGE_KEY)?.trim();
    return id || null;
  } catch {
    return null;
  }
}

/** Drop persistence when the run finishes or is abandoned client-side. */
export function clearPersistedActiveResearchRunId(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
