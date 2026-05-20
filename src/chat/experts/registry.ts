/**
 * Expert registry: scan built-in + user prompt dirs, merge, cache.
 */

import { parsePromptMarkdown } from '../prompts/parse-front-matter';
import { parseExpertMetaFromMarkdown } from './expert-meta-parse';
import type { ExpertMeta, ExpertRecord } from './types';

const SKIP_PREFIXES = ['_template', '_example'];

/** Built-in raw map from Vite glob (lazy). */
let builtinRaw: Record<string, string> | null = null;

const builtinRegistry = new Map<string, ExpertRecord>();
const userRegistry = new Map<string, ExpertRecord>();

function shouldSkipExpertId(id: string): boolean {
  if (!id || id.startsWith('_')) return true;
  return SKIP_PREFIXES.some((p) => id === p || id.startsWith(`${p}/`));
}

function expertIdFromPath(relativePath: string): string | null {
  const norm = relativePath.replace(/\\/g, '/');
  const match = norm.match(/experts\/([^/]+)\/expert\.(full|lite)\.md$/);
  return match?.[1] ?? null;
}

interface ExpertAccumulator {
  meta?: ExpertMeta;
  fullBody?: string;
  liteBody?: string;
  source: 'builtin' | 'user';
}

function mergeAccumulator(
  accMap: Map<string, ExpertAccumulator>,
  expertId: string,
  suffix: 'full' | 'lite',
  raw: string,
  relativePath: string,
  source: 'builtin' | 'user',
): void {
  if (shouldSkipExpertId(expertId)) return;

  let acc = accMap.get(expertId);
  if (!acc) {
    acc = { source };
    accMap.set(expertId, acc);
  }

  if (suffix === 'full') {
    const meta = parseExpertMetaFromMarkdown(raw, relativePath);
    if (meta) acc.meta = meta;
    try {
      const { markdownBody } = parsePromptMarkdown(raw, relativePath);
      acc.fullBody = markdownBody.trim();
    } catch {
      /* skip */
    }
  } else {
    try {
      const { markdownBody } = parsePromptMarkdown(raw, relativePath);
      acc.liteBody = markdownBody.trim();
    } catch {
      /* skip */
    }
  }
}

function buildRegistryFromRaw(
  rawMap: Record<string, string>,
  source: 'builtin' | 'user',
): Map<string, ExpertRecord> {
  const accMap = new Map<string, ExpertAccumulator>();

  for (const [globPath, raw] of Object.entries(rawMap)) {
    const relativePath = globPath
      .replace(/^\.\//, '')
      .replace(/^.*?prompts[\\/]/, '');
    if (!relativePath.includes('experts/')) continue;

    const expertId = expertIdFromPath(relativePath);
    if (!expertId) continue;

    const suffix = relativePath.endsWith('.lite.md') ? 'lite' : 'full';
    mergeAccumulator(accMap, expertId, suffix, raw, relativePath, source);
  }

  const out = new Map<string, ExpertRecord>();
  for (const [id, acc] of accMap) {
    if (!acc.meta || !acc.fullBody?.trim()) continue;
    out.set(id, {
      meta: acc.meta,
      fullBody: acc.fullBody,
      liteBody: acc.liteBody,
      source: acc.source,
    });
  }
  return out;
}

/** Initialize built-in experts from Vite glob (idempotent). */
export function initBuiltinExpertRegistry(raw: Record<string, string> = {}): void {
  if (builtinRegistry.size > 0 && Object.keys(raw).length === 0) return;
  builtinRaw = raw;
  builtinRegistry.clear();
  const built = buildRegistryFromRaw(raw, 'builtin');
  for (const [id, record] of built) {
    builtinRegistry.set(id, record);
  }
}

/** Replace user expert overrides (from server registry scan). */
export function setUserExpertRegistry(records: ExpertRecord[]): void {
  userRegistry.clear();
  for (const record of records) {
    userRegistry.set(record.meta.id, record);
  }
}

/** Register expert files for tests. */
export function registerExpertFilesFromRaw(
  rawMap: Record<string, string>,
  source: 'builtin' | 'user' = 'builtin',
): void {
  const built = buildRegistryFromRaw(rawMap, source);
  const target = source === 'user' ? userRegistry : builtinRegistry;
  for (const [id, record] of built) {
    target.set(id, record);
  }
}

export function resetExpertRegistry(): void {
  builtinRegistry.clear();
  userRegistry.clear();
  builtinRaw = null;
}

function mergedRegistry(): ExpertRecord[] {
  const ids = new Set<string>([...builtinRegistry.keys(), ...userRegistry.keys()]);
  const list: ExpertRecord[] = [];
  for (const id of ids) {
    const record = userRegistry.get(id) ?? builtinRegistry.get(id);
    if (record) list.push(record);
  }
  return list.sort((a, b) => a.meta.label.localeCompare(b.meta.label));
}

/** List all experts for dropdown (sorted by label). */
export function listExperts(): ExpertRecord[] {
  if (builtinRegistry.size === 0 && builtinRaw) {
    initBuiltinExpertRegistry(builtinRaw);
  }
  return mergedRegistry();
}

/** Get one expert by id. */
export function getExpert(id: string): ExpertRecord | null {
  return userRegistry.get(id) ?? builtinRegistry.get(id) ?? null;
}

/** Reload built-in + optional user experts from prompt registry API. */
export async function refreshExpertRegistry(
  builtinRawMap?: Record<string, string>,
): Promise<void> {
  if (builtinRawMap) {
    builtinRegistry.clear();
    initBuiltinExpertRegistry(builtinRawMap);
  } else if (builtinRaw) {
    initBuiltinExpertRegistry(builtinRaw);
  }

  try {
    const res = await fetch('/api/prompts/registry', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as {
      prompts?: { kind: string; id: string; source: string; relativePath?: string }[];
    };
    const expertIds = new Set(
      (body.prompts ?? [])
        .filter((p) => p.kind === 'expert' && p.source === 'user')
        .map((p) => p.id),
    );
    if (expertIds.size === 0) {
      userRegistry.clear();
      return;
    }
    /* User bodies are loaded via prompt-loader; re-scan would need file fetch.
       For now user overrides in browser use same built-in scan + prompt-loader merge. */
  } catch {
    /* dev without server */
  }
}

/** Load built-in experts using bundled prompt markdown (call from init). */
export function loadBuiltinExpertsFromPromptRaw(raw: Record<string, string>): void {
  initBuiltinExpertRegistry(raw);
}
