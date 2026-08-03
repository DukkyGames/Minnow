/**
 * LSP → SQLite indexer for the Brain code graph.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRipgrepPath } from '../../lib/ripgrep-path.js';
import {
  getLspCallHierarchy,
  getLspDocumentSymbols,
  notifyLspDocument,
} from '../../lsp/manager.js';
import { getWorkspaceRoot } from '../../workspace/root.js';
import { brainWorkspaceKeyFromPath } from '../paths.js';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';
import { normalizeBrainCodeConfig } from './config.js';
import {
  deleteSymbolsForFile,
  getCodeDb,
  upsertEdge,
  upsertFileHash,
  upsertSymbol,
  writePageRanks,
} from './schema.js';
import {
  buildAdjacency,
  buildPersonalizationVector,
  personalizedPageRank,
} from './rank.js';
import { runGrepSearch } from '../../tools/grep.js';
import { ensureBrainLspProjectReady } from './project-scaffold.js';

const execFileAsync = promisify(execFile);

const rgExecutable = getRipgrepPath();

/** LSP SymbolKind → short string for storage. */
const KIND_NAMES = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  22: 'enum-member',
  23: 'struct',
};

/**
 * @param {number | string | undefined} kind
 */
export function symbolKindName(kind) {
  if (typeof kind === 'string' && kind) return kind;
  const n = Number(kind);
  return KIND_NAMES[n] ?? 'symbol';
}

/**
 * Stable symbol id: "<repo>:<qualified.name>" (never line numbers).
 * @param {string} repo
 * @param {string} qualifiedName
 */
export function buildSymbolId(repo, qualifiedName) {
  return `${repo}:${qualifiedName}`;
}

/**
 * Elide a long signature for repo-map display.
 * @param {string} name
 * @param {string} kind
 * @param {string} [detail]
 */
export function elideSignature(name, kind, detail) {
  const base = detail?.trim() ? `${kind} ${name}${detail.trim().startsWith('(') ? '' : ' '}${detail.trim()}` : `${kind} ${name}`;
  if (base.length <= 120) return base;
  return `${base.slice(0, 117)}…`;
}

/**
 * sha256 of the source lines covering a symbol span.
 * @param {string[]} lines — 0-based file lines
 * @param {{ start: { line: number }, end: { line: number } }} range
 */
export function hashSymbolSpan(lines, range) {
  const start = Math.max(0, range?.start?.line ?? 0);
  const end = Math.max(start, range?.end?.line ?? start);
  const slice = lines.slice(start, end + 1).join('\n');
  return createHash('sha256').update(slice, 'utf8').digest('hex');
}

/**
 * Flatten hierarchical document symbols into rows with qualified names.
 * @param {Array<Record<string, unknown>>} symbols
 * @param {string} repo
 * @param {string} file
 * @param {string[]} lines
 * @param {string} [prefix]
 */
export function flattenDocumentSymbols(symbols, repo, file, lines, prefix = '') {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const sym of symbols ?? []) {
    if (!sym || typeof sym !== 'object') continue;
    const name = String(sym.name ?? '');
    if (!name) continue;
    const qualified = prefix ? `${prefix}.${name}` : name;
    const kind = symbolKindName(sym.kind);
    const range = sym.range ?? sym.selectionRange;
    const lineStart = (range?.start?.line ?? 0) + 1;
    const lineEnd = (range?.end?.line ?? range?.start?.line ?? 0) + 1;
    const signature = elideSignature(name, kind, sym.detail != null ? String(sym.detail) : '');
    const contentHash = hashSymbolSpan(lines, range ?? { start: { line: 0 }, end: { line: 0 } });
    const id = buildSymbolId(repo, qualified);
    out.push({
      id,
      repo,
      kind,
      name,
      qualified,
      file,
      line_start: lineStart,
      line_end: lineEnd,
      signature,
      doc: sym.detail != null ? String(sym.detail) : '',
      content_hash: contentHash,
      selection: sym.selectionRange ?? range,
    });
    if (Array.isArray(sym.children) && sym.children.length > 0) {
      out.push(...flattenDocumentSymbols(sym.children, repo, file, lines, qualified));
    }
  }
  return out;
}

/**
 * Normalize a ripgrep file path to a workspace-relative posix path.
 * Handles absolute paths and duplicated root prefixes on Windows.
 * @param {string} root
 * @param {string} relOrAbs
 */
export function normalizeIndexableRelPath(root, relOrAbs) {
  const normalizedRoot = path.resolve(root);
  const rootPosix = normalizedRoot.replace(/\\/g, '/');
  let candidate = String(relOrAbs ?? '').trim().replace(/\\/g, '/');
  if (!candidate) return '';

  const marker = `${rootPosix}/`;
  const doubled = `${rootPosix}/${rootPosix}/`;
  if (candidate.includes(doubled)) {
    candidate = candidate.split(doubled).pop() ?? candidate;
  }
  while (candidate.startsWith(marker)) {
    candidate = candidate.slice(marker.length);
  }

  let abs = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(normalizedRoot, candidate);
  let rel = path.relative(normalizedRoot, abs).replace(/\\/g, '/');

  if (!rel || rel.startsWith('..')) {
    const tail = candidate.includes(marker) ? candidate.split(marker).pop() : candidate;
    if (tail) {
      abs = path.resolve(normalizedRoot, tail);
      rel = path.relative(normalizedRoot, abs).replace(/\\/g, '/');
    }
  }

  if (!rel || rel.startsWith('..')) return '';
  return rel;
}

/**
 * List indexable files via ripgrep (respects .gitignore).
 * @param {string} root
 * @param {string[]} includeGlobs
 * @param {string[]} excludeGlobs
 */
export async function listIndexableFiles(root, includeGlobs, excludeGlobs) {
  const args = ['--files', '--no-messages'];
  for (const glob of excludeGlobs ?? []) {
    if (glob.trim()) args.push('--glob', `!${glob.replace(/^!/, '')}`);
  }
  for (const glob of includeGlobs ?? []) {
    if (glob.trim()) args.push('--glob', glob);
  }
  args.push(root);
  let stdout = '';
  try {
    const result = await execFileAsync(rgExecutable, args, {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = result.stdout ?? '';
  } catch (err) {
    // Ripgrep exits 1 when no files match the include globs — treat as empty.
    const code = err && typeof err === 'object' ? err.code : undefined;
    if (code === 1) {
      return [];
    }
    throw err;
  }
  const rel = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
  const normalizedRoot = path.resolve(root);
  return rel
    .map((p) => normalizeIndexableRelPath(normalizedRoot, p))
    .filter(Boolean);
}

/**
 * Resolve a call-hierarchy item to a symbol id in the current file index.
 * @param {Map<string, { id: string, line_start: number, line_end: number }>} byFileLine
 * @param {string} repo
 * @param {{ name?: string, path?: string, range?: { start?: { line?: number } } }} item
 */
function resolveCallItemToSymbolId(byFileLine, repo, item) {
  const file = String(item.path ?? '').replace(/\\/g, '/');
  const line = (item.range?.start?.line ?? 0) + 1;
  const key = `${file}:${line}`;
  const hit = byFileLine.get(key);
  if (hit) return hit.id;
  const name = String(item.name ?? '');
  if (!name) return null;
  return buildSymbolId(repo, name);
}

/**
 * Index one file: symbols, call edges, file hash.
 * @param {import('better-sqlite3').Database} db
 * @param {string} repo
 * @param {string} relFile
 * @param {string} absFile
 * @param {Map<string, { id: string, line_start: number, line_end: number }>} globalByFileLine
 */
export async function indexSingleFile(db, repo, relFile, absFile, globalByFileLine) {
  const text = await fs.readFile(absFile, 'utf8');
  const lines = text.split(/\r?\n/);
  const stat = await fs.stat(absFile);
  const fileHash = createHash('sha256').update(text, 'utf8').digest('hex');

  await notifyLspDocument(relFile, 'open', text);
  const { symbols: tree, error } = await getLspDocumentSymbols(relFile);
  if (error) {
    return { file: relFile, symbols: 0, edges: 0, error };
  }

  const flat = flattenDocumentSymbols(tree, repo, relFile, lines);
  deleteSymbolsForFile(db, repo, relFile);

  const byFileLine = new Map();
  for (const row of flat) {
    upsertSymbol(db, {
      id: row.id,
      repo: row.repo,
      kind: row.kind,
      name: row.name,
      file: row.file,
      line_start: row.line_start,
      line_end: row.line_end,
      signature: row.signature,
      doc: row.doc,
      content_hash: row.content_hash,
      pagerank: 0,
      usage_count: 0,
    });
    byFileLine.set(`${relFile}:${row.line_start}`, {
      id: row.id,
      line_start: row.line_start,
      line_end: row.line_end,
    });
    globalByFileLine.set(`${relFile}:${row.line_start}`, {
      id: row.id,
      line_start: row.line_start,
      line_end: row.line_end,
    });
  }

  let edgeCount = 0;
  for (const row of flat) {
    const kind = row.kind;
    if (!['function', 'method', 'constructor'].includes(kind)) continue;
    const sel = row.selection ?? { start: { line: row.line_start - 1, character: 0 } };
    const line = sel.start?.line ?? row.line_start - 1;
    const character = sel.start?.character ?? 0;
    const hierarchy = await getLspCallHierarchy(relFile, line, character);
    if (!hierarchy.item) continue;

    for (const out of hierarchy.outgoingCalls ?? []) {
      const dst = resolveCallItemToSymbolId(globalByFileLine, repo, out.to ?? {});
      if (!dst) continue;
      upsertEdge(db, row.id, dst, 'calls');
      edgeCount += 1;
    }
    for (const inc of hierarchy.incomingCalls ?? []) {
      const src = resolveCallItemToSymbolId(globalByFileLine, repo, inc.from ?? {});
      if (!src) continue;
      upsertEdge(db, src, row.id, 'calls');
      edgeCount += 1;
    }
  }

  upsertFileHash(db, repo, relFile, fileHash, stat.mtimeMs);
  await notifyLspDocument(relFile, 'close');
  return { file: relFile, symbols: flat.length, edges: edgeCount };
}

/** Max symbols to grep for usage_count augmentation per reindex pass. */
const USAGE_AUGMENT_MAX_SYMBOLS = 1500;
/** Concurrent ripgrep workers during usage_count augmentation. */
const USAGE_AUGMENT_CONCURRENCY = 8;
/** Wall-clock budget for usage_count augmentation (ms). */
const USAGE_AUGMENT_TIME_BUDGET_MS = 30_000;

/**
 * Run async work over items with bounded concurrency.
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn
 * @param {() => boolean} shouldContinue
 */
async function runBoundedPool(items, concurrency, fn, shouldContinue) {
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length && shouldContinue()) {
      const idx = nextIdx++;
      await fn(items[idx]);
    }
  }
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * Augment usage_count via ripgrep name hits (ranking input).
 * Bounded by symbol cap, concurrency pool, and wall-clock budget.
 * @param {import('better-sqlite3').Database} db
 * @param {string} repo
 * @param {ReturnType<typeof getWorkspaceRoot>} root
 */
async function augmentUsageCounts(db, repo, root) {
  const symbols = db
    .prepare(
      `SELECT id, name FROM symbols WHERE repo = ?
       ORDER BY usage_count DESC, pagerank DESC
       LIMIT ?`,
    )
    .all(repo, USAGE_AUGMENT_MAX_SYMBOLS);
  const deps = {
    resolveSafePath: (p) => path.resolve(root, p),
    toRelativePath: (abs) => path.relative(root, abs).replace(/\\/g, '/'),
    getWorkspaceRoot: () => root,
  };
  const started = Date.now();
  const shouldContinue = () => Date.now() - started < USAGE_AUGMENT_TIME_BUDGET_MS;
  const updateStmt = db.prepare('UPDATE symbols SET usage_count = ? WHERE id = ?');

  await runBoundedPool(
    symbols,
    USAGE_AUGMENT_CONCURRENCY,
    async (sym) => {
      if (!shouldContinue()) return;
      const name = String(sym.name ?? '');
      if (!name || name.length < 3) return;
      const out = await runGrepSearch(
        { pattern: `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, head_limit: 50, literal: false },
        deps,
      );
      if (out.startsWith('Error:')) return;
      const count = out.split(/\r?\n/).filter((line) => /:\d+:/.test(line)).length;
      updateStmt.run(count, sym.id);
    },
    shouldContinue,
  );
}

/**
 * Recompute PageRank after indexing.
 * @param {import('better-sqlite3').Database} db
 * @param {Set<string>} [focusFiles]
 */
export function recomputePageRank(db, focusFiles = new Set()) {
  const edges = db.prepare('SELECT src_symbol, dst_symbol FROM edges').all();
  const { out, nodes } = buildAdjacency(edges);
  if (nodes.size === 0) return;
  const symbols = db.prepare('SELECT id, file, usage_count FROM symbols').all();
  const personal = buildPersonalizationVector(nodes, symbols, focusFiles);
  const ranks = personalizedPageRank(out, nodes, personal);
  writePageRanks(db, ranks);
}

/**
 * Full-repo or incremental reindex.
 * @param {{ files?: string[], focusFiles?: string[], codeConfig?: ReturnType<typeof normalizeBrainCodeConfig> }} [opts]
 */
export async function reindexCode(opts = {}) {
  const root = getEffectiveWorkspaceRoot();
  const repo = brainWorkspaceKeyFromPath(root) || 'workspace';
  const codeConfig = opts.codeConfig ?? normalizeBrainCodeConfig(null);
  const db = getCodeDb(repo);

  const scaffold = await ensureBrainLspProjectReady(root, {
    enabled: codeConfig.autoScaffoldIndexConfig !== false,
  });

  let files = opts.files?.map((f) => normalizeIndexableRelPath(root, f)).filter(Boolean) ?? null;
  if (!files) {
    files = await listIndexableFiles(root, codeConfig.includeGlobs, codeConfig.excludeGlobs);
  }

  const globalByFileLine = new Map();
  const results = [];
  for (const relFile of files) {
    const absFile = path.join(root, relFile);
    try {
      const stat = await fs.stat(absFile);
      if (!stat.isFile()) continue;
      const existing = db
        .prepare('SELECT sha256 FROM file_hashes WHERE repo = ? AND file = ?')
        .get(repo, relFile);
      const text = await fs.readFile(absFile, 'utf8');
      const hash = createHash('sha256').update(text, 'utf8').digest('hex');
      if (existing?.sha256 === hash && !opts.files) {
        continue;
      }
      const result = await indexSingleFile(db, repo, relFile, absFile, globalByFileLine);
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ file: relFile, symbols: 0, edges: 0, error: message });
    }
  }

  await augmentUsageCounts(db, repo, root);
  recomputePageRank(db, new Set(opts.focusFiles ?? []));

  return {
    repo,
    indexedFiles: results.filter((r) => !r.error).length,
    results,
    scaffold,
  };
}
