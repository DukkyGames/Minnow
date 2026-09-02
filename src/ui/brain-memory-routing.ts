export type BrainMemoryRouteSection = 'memories' | 'settings';

/** Map settings memory slug or catalog key to a Brain section. */
export function resolveBrainMemoryRoute(
  searchKey?: string,
  settingsSection?: string,
): BrainMemoryRouteSection | null {
  if (settingsSection === 'memory') return 'memories';
  if (!searchKey?.startsWith('knowledge.memory')) return null;
  if (searchKey.includes('.embeddings') || searchKey.includes('.synthesis')) {
    return 'settings';
  }
  return 'memories';
}
