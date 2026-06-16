/**
 * One-time idempotent migration from ~/.minnow/memory/ to the brain wiki.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getEntriesDir, getIndexPath, getMemoryDir } from '../memory/paths.js';
import { backupMemory } from '../memory/backup.js';
import { getEnginePaths as getBrainEnginePaths } from './engine-paths.js';
import { getBrainStatePath } from './paths.js';
import {
  buildCatalogEntry,
  createPage,
  ensureBrainLayout,
  parsePageMarkdown,
  rebuildCatalog,
} from './store.js';

/** Parse legacy memory entry markdown (frontmatter + body). */
function parseMemoryEntryMarkdown(raw, id) {
  const trimmed = String(raw ?? '');
  if (!trimmed.startsWith('---')) {
    return { body: trimmed };
  }
  const end = trimmed.indexOf('---', 3);
  if (end < 0) return { body: trimmed };
  return { body: trimmed.slice(end + 3).trim() };
}

/** Slugify a title for pages/facts/<slug>.md filenames. */
function slugifyTitle(title) {
  const slug = String(title ?? 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'untitled';
}

async function readBrainState() {
  try {
    const raw = await fs.readFile(getBrainStatePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { migratedFromMemory: false };
  }
}

async function writeBrainState(patch) {
  const current = await readBrainState();
  const next = { ...current, ...patch };
  await fs.writeFile(getBrainStatePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

async function copyFileIfExists(src, dest) {
  try {
    await fs.access(src);
    await fs.copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

async function loadMemoryIndex() {
  try {
    const raw = await fs.readFile(getIndexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** Prevent re-entrant migration while createPage loads config during migrate. */
let migrationInProgress = false;

/** Return true when migration already completed. */
export async function isMigratedFromMemory() {
  const state = await readBrainState();
  return Boolean(state.migratedFromMemory);
}

/**
 * Migrate flat memory entries into pages/facts/, copy vectors/proposals, archive memory.
 * Safe to call multiple times — subsequent runs are no-ops.
 */
export async function migrateFromMemory() {
  if (migrationInProgress) {
    return { migrated: false, reason: 'in-progress', entryCount: 0 };
  }

  await ensureBrainLayout();

  if (await isMigratedFromMemory()) {
    return { migrated: false, reason: 'already-migrated', entryCount: 0 };
  }

  migrationInProgress = true;
  try {
    return await runMemoryMigration();
  } finally {
    migrationInProgress = false;
  }
}

async function runMemoryMigration() {
  const entries = await loadMemoryIndex();
  if (entries.length === 0) {
    await writeBrainState({
      migratedFromMemory: true,
      migratedAt: new Date().toISOString(),
      entryCount: 0,
    });
    return { migrated: true, reason: 'no-entries', entryCount: 0 };
  }

  const usedSlugs = new Set();
  let migratedCount = 0;

  for (const entry of entries) {
    const id = String(entry.id ?? '');
    const baseSlug = slugifyTitle(entry.title);
    let slug = baseSlug;
    let n = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${n}`;
      n += 1;
    }
    usedSlugs.add(slug);

    let relPath = `facts/${slug}.md`;
    const entryFile = path.join(getEntriesDir(), `${id}.md`);
    let body = '';
    try {
      const raw = await fs.readFile(entryFile, 'utf8');
      ({ body } = parseMemoryEntryMarkdown(raw, id));
    } catch {
      body = '';
    }

    const abs = path.join(getBrainEnginePaths().rootDir, 'pages', relPath);
    try {
      await fs.access(abs);
      const existingRaw = await fs.readFile(abs, 'utf8');
      const { front } = parsePageMarkdown(existingRaw, id);
      if (front.id === id) {
        migratedCount += 1;
        continue;
      }
      slug = `${baseSlug}-${id.slice(0, 8)}`;
      relPath = `facts/${slug}.md`;
    } catch {
      /* page does not exist yet */
    }

    await createPage({
      relPath,
      id,
      title: entry.title ?? 'Untitled',
      tags: entry.tags ?? [],
      source: entry.source === 'agent' || entry.source === 'self-heal' ? 'agent' : 'user',
      pinned: Boolean(entry.pinned),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      body,
      skipVectorSync: true,
    });
    migratedCount += 1;
  }

  const memoryDir = getMemoryDir();
  const brainPaths = getBrainEnginePaths();
  await copyFileIfExists(path.join(memoryDir, 'vectors.json'), brainPaths.vectorsPath);
  await copyFileIfExists(path.join(memoryDir, 'proposals.json'), brainPaths.proposalsPath);

  await rebuildCatalog();

  let archivePath = null;
  try {
    const backup = await backupMemory();
    archivePath = backup.path;
  } catch {
    /* memory backup is best-effort */
  }

  await writeBrainState({
    migratedFromMemory: true,
    migratedAt: new Date().toISOString(),
    entryCount: migratedCount,
    archivePath,
  });

  return { migrated: true, reason: 'completed', entryCount: migratedCount, archivePath };
}

/** Exported for tests — build a catalog entry shape from memory meta. */
export function memoryEntryToCatalogShape(entry, relPath, body) {
  const front = {
    id: entry.id,
    title: entry.title,
    tags: entry.tags,
    source: entry.source === 'agent' || entry.source === 'self-heal' ? 'agent' : 'user',
    pinned: entry.pinned,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    status: 'current',
    summary: '',
    anchors: [],
    input_hash: '',
  };
  return buildCatalogEntry(front, relPath, body);
}
