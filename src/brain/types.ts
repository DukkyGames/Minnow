/**
 * Brain wiki API types (MIN-B5).
 */

/** Page metadata from catalog.json / readPage. */
export interface BrainPageMeta {
  id: string;
  title: string;
  path: string;
  folder: string;
  slug: string;
  tags: string[];
  source: string;
  summary: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  links: string[];
  status?: string;
}

/** Full page payload from GET /api/brain/page. */
export interface BrainPage {
  meta: BrainPageMeta;
  body: string;
  path: string;
}

/** Leaf node in GET /api/brain/tree. */
export interface BrainTreePageNode extends BrainPageMeta {
  type: 'page';
}

/** Folder node in the page tree. */
export interface BrainTreeFolderNode {
  type: 'folder';
  children: Record<string, BrainTreeNode>;
}

export type BrainTreeNode = BrainTreePageNode | BrainTreeFolderNode;

/** Server status from GET /api/brain/status. */
export interface BrainStatus {
  enabled: boolean;
  pageCount: number;
  home: string;
  brainDir: string;
}

/** POST /api/brain/ingest result. */
export interface BrainIngestResult {
  sourcePath: string;
  pages: string[];
}

/** POST /api/brain/lint health report. */
export interface BrainLintReport {
  generatedAt: string;
  pageCount: number;
  orphans: Array<{ path: string; title: string; status?: string }>;
  stale: Array<{ path: string; title: string; status?: string }>;
  missingLinks: Array<{ from: string; target: string; summary: string }>;
  contradictions: Array<{ pages: string[]; summary: string }>;
  embeddingsEnabled: boolean;
}
