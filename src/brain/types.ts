/**
 * Brain wiki + code index API types (MIN-B5 / MIN-B8).
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
  /** Archive similarity neighbors (from frontmatter similarTo). */
  similarTo?: string[];
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
  anchorDrift?: Array<{
    path: string;
    title: string;
    symbolIds: string[];
    summary: string;
  }>;
  missingLinks: Array<{ from: string; target: string; summary: string }>;
  contradictions: Array<{ pages: string[]; summary: string }>;
  embeddingsEnabled: boolean;
  applied?: Array<{ path: string; action: string }>;
}

/** When to trigger background reindex (automation wired in MIN-B10). */
export type BrainCodeReindexCadence = 'on-demand' | 'on-switch' | 'git-hook';

/** config.brain.code settings. */
export interface BrainCodeConfig {
  enabled: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  repoMapTokenBudget: number;
  reindexCadence: BrainCodeReindexCadence;
  codeEmbeddingsEnabled: boolean;
  /** Write .minnow/jsconfig.json when JS/TS sources lack ts/js config. */
  autoScaffoldIndexConfig: boolean;
}

/** GET /api/brain/code/status. */
export interface BrainCodeStatus extends BrainCodeConfig {
  repo: string;
  symbolCount: number;
  edgeCount: number;
  fileCount: number;
  lastIndexedAt: string | null;
}

/** Symbol row from find_symbol / graph queries. */
export interface BrainCodeSymbolMatch {
  id: string;
  repo: string;
  kind: string;
  name: string;
  file: string;
  line_start: number;
  line_end: number;
  signature: string;
  source?: string;
}

/** GET/POST /api/brain/code/find-symbol. */
export interface BrainCodeFindResult {
  matches: BrainCodeSymbolMatch[];
  error?: string;
}

/** One structured row in the repo map (UI navigation). */
export type BrainCodeRepoMapEntry =
  | { type: 'title'; text: string }
  | { type: 'file'; file: string; text: string }
  | { type: 'symbol'; symbolId: string; file: string; text: string }
  | { type: 'truncated'; text: string }
  | { type: 'message'; text: string };

/** GET/POST /api/brain/code/repo-map. */
export interface BrainCodeRepoMap {
  text: string;
  truncated: boolean;
  tokenEstimate: number;
  /** Structured rows with symbol ids for clickable UI navigation. */
  entries?: BrainCodeRepoMapEntry[];
}

/** Edge endpoint in who_calls / calls_of. */
export interface BrainCodeSymbolRef {
  symbolId: string;
  name: string;
  file: string;
  line: number;
  signature: string;
  kind: string;
}

/** GET/POST /api/brain/code/who-calls. */
export interface BrainCodeWhoCallsResult {
  symbol: BrainCodeSymbolMatch | null;
  callers: BrainCodeSymbolRef[];
  error?: string;
}

/** GET/POST /api/brain/code/calls-of. */
export interface BrainCodeCallsOfResult {
  symbol: BrainCodeSymbolMatch | null;
  callees: BrainCodeSymbolRef[];
  error?: string;
}

/** GET/POST /api/brain/code/read-symbol. */
export interface BrainCodeReadSymbolResult {
  symbol: BrainCodeSymbolMatch | null;
  text: string;
  error?: string;
}

/** GET /api/brain/code/git-hook/status. */
export interface BrainCodeGitHookStatus {
  hookPath: string;
  installed: boolean;
  isGitRepo?: boolean;
  scriptPath: string;
}

/** POST /api/brain/code/git-hook/install. */
export interface BrainCodeGitHookInstallResult {
  ok?: boolean;
  installed?: boolean;
  hookPath?: string;
  alreadyPresent?: boolean;
  error?: string;
}

/** POST /api/brain/code/reindex. */
export interface BrainCodeReindexResult {
  ok: boolean;
  repo: string;
  indexedFiles: number;
  results?: Array<{ file: string; symbols: number; edges: number; error?: string }>;
  scaffold?: {
    created: boolean;
    path?: string;
    skipped?: boolean;
    reason?: string;
  };
}

/** Wiki page anchored to a symbol (explain_symbol). */
export interface BrainCodeExplainPage {
  pageId: string;
  path: string;
  title: string;
  summary: string;
  status?: string;
  symbolId: string;
  symbolHashAtSynth?: string;
}

/** GET/POST /api/brain/code/explain. */
export interface BrainCodeExplainResult {
  symbolId?: string;
  pages: BrainCodeExplainPage[];
  error?: string;
}
