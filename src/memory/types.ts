/**
 * Memory API types (Step 16).
 */

export interface MemoryEntryMeta {
  id: string;
  title: string;
  tags: string[];
  source: 'user' | 'agent' | 'self-heal';
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  maxEntries: number;
  maxInjectCharsFull: number;
  maxInjectCharsLite: number;
  retrieveLimit: number;
  defaultTags: string[];
}

export interface MemoryRetrieveResult {
  block: string;
  ids: string[];
}
