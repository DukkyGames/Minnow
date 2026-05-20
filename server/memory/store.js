/**
 * Memory entry CRUD and index maintenance under ~/.minnow/memory/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readConfigJson, writeConfigJson } from '../config/store.js';
import {
  getEntriesDir,
  getIndexPath,
  getMemoryDir,
  entryFilePath,
  isValidEntryId,
} from './paths.js';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_ENTRIES = 500;

const DEFAULT_INDEX = { version: 1, entries: [] };

/** Default memory section in config.json when missing. */
export const DEFAULT_MEMORY_CONFIG = {
  enabled: true,
  maxEntries: MAX_ENTRIES,
  maxInjectCharsFull: 4000,
  maxInjectCharsLite: 800,
  retrieveLimit: 20,
  defaultTags: [],
};

async function ensureLayout() {
  await fs.mkdir(getEntriesDir(), { recursive: true });
  const indexPath = getIndexPath();
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(
      indexPath,
      `${JSON.stringify(DEFAULT_INDEX, null, 2)}\n`,
      'utf8',
    );
  }
}

/** Load merged memory config from config.json. */
export async function loadMemoryConfig() {
  const config = (await readConfigJson('config.json')) ?? {};
  const memory =
    config.memory && typeof config.memory === 'object'
      ? { ...DEFAULT_MEMORY_CONFIG, ...config.memory }
      : { ...DEFAULT_MEMORY_CONFIG };
  return memory;
}

/** Persist memory.enabled and limits into config.json. */
export async function saveMemoryConfig(partial) {
  const config = (await readConfigJson('config.json')) ?? {};
  config.memory = {
    ...DEFAULT_MEMORY_CONFIG,
    ...(config.memory && typeof config.memory === 'object' ? config.memory : {}),
    ...partial,
  };
  await writeConfigJson('config.json', config);
  return config.memory;
}

async function loadIndex() {
  await ensureLayout();
  const raw = await fs.readFile(getIndexPath(), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_INDEX };
  return {
    version: parsed.version ?? 1,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

async function saveIndex(index) {
  const tmp = `${getIndexPath()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, getIndexPath());
}

function parseEntryMarkdown(raw, id) {
  const trimmed = String(raw ?? '');
  if (!trimmed.startsWith('---')) {
    return { front: {}, body: trimmed };
  }
  const end = trimmed.indexOf('---', 3);
  if (end < 0) return { front: {}, body: trimmed };
  const frontBlock = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 3).trim();
  const front = {};
  for (const line of frontBlock.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) front[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!front.id) front.id = id;
  return { front, body };
}

function serializeEntry(meta, body) {
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  return `---
id: "${meta.id}"
title: "${String(meta.title ?? '').replace(/"/g, '\\"')}"
tags: [${tags.map((t) => t).join(', ')}]
source: ${meta.source ?? 'user'}
---

${body}`;
}

/** List entry metadata from index. */
export async function listEntries() {
  const index = await loadIndex();
  return index.entries;
}

/** Read one entry by id. */
export async function getEntry(id) {
  if (!isValidEntryId(id)) return null;
  const index = await loadIndex();
  const meta = index.entries.find((e) => e.id === id);
  if (!meta) return null;
  const filePath = entryFilePath(id);
  const raw = await fs.readFile(filePath, 'utf8');
  const { body } = parseEntryMarkdown(raw, id);
  return { entry: meta, body };
}

/** Create a new memory entry. */
export async function createEntry(input) {
  const index = await loadIndex();
  if (index.entries.length >= MAX_ENTRIES) {
    const err = new Error('Memory entry limit reached');
    err.statusCode = 507;
    throw err;
  }

  const body = String(input.body ?? '');
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    const err = new Error('Entry body exceeds 32KB limit');
    err.statusCode = 413;
    throw err;
  }

  const id =
    input.id && isValidEntryId(input.id) ? input.id : randomUUID();
  if (index.entries.some((e) => e.id === id)) {
    const err = new Error('Entry id already exists');
    err.statusCode = 409;
    throw err;
  }

  const now = new Date().toISOString();
  const meta = {
    id,
    title: String(input.title ?? 'Untitled').slice(0, 200),
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).slice(0, 64))
      : [],
    source: input.source === 'agent' || input.source === 'self-heal' ? input.source : 'user',
    createdAt: now,
    updatedAt: now,
    pinned: Boolean(input.pinned),
  };

  await fs.writeFile(
    entryFilePath(id),
    serializeEntry(meta, body),
    'utf8',
  );
  index.entries.push(meta);
  await saveIndex(index);
  return meta;
}

/** Update an existing entry. */
export async function updateEntry(id, input) {
  if (!isValidEntryId(id)) return null;
  const index = await loadIndex();
  const idx = index.entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;

  const existing = await getEntry(id);
  if (!existing) return null;

  let body = existing.body;
  if (input.body !== undefined) {
    body = String(input.body);
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      const err = new Error('Entry body exceeds 32KB limit');
      err.statusCode = 413;
      throw err;
    }
  }

  const meta = { ...index.entries[idx] };
  if (input.title !== undefined) meta.title = String(input.title).slice(0, 200);
  if (input.tags !== undefined) {
    meta.tags = Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).slice(0, 64))
      : [];
  }
  if (input.pinned !== undefined) meta.pinned = Boolean(input.pinned);
  meta.updatedAt = new Date().toISOString();

  await fs.writeFile(entryFilePath(id), serializeEntry(meta, body), 'utf8');
  index.entries[idx] = meta;
  await saveIndex(index);
  return meta;
}

/** Delete an entry. */
export async function deleteEntry(id) {
  if (!isValidEntryId(id)) return false;
  const index = await loadIndex();
  const before = index.entries.length;
  index.entries = index.entries.filter((e) => e.id !== id);
  if (index.entries.length === before) return false;
  await saveIndex(index);
  try {
    await fs.unlink(entryFilePath(id));
  } catch {
    /* file may already be gone */
  }
  return true;
}

/** Remove all entries; optionally archive first. */
export async function clearEntries(archive = false) {
  const index = await loadIndex();
  const count = index.entries.length;
  if (count === 0) return { removed: 0, archivePath: null };

  let archivePath = null;
  if (archive) {
    const { backupMemory } = await import('./backup.js');
    const backup = await backupMemory();
    archivePath = backup.path;
  }

  for (const e of index.entries) {
    try {
      await fs.unlink(entryFilePath(e.id));
    } catch {
      /* ignore */
    }
  }
  await saveIndex({ version: 1, entries: [] });
  return { removed: count, archivePath };
}

/** Entry count for status. */
export async function getEntryCount() {
  const index = await loadIndex();
  return index.entries.length;
}

/** Read all entries with bodies for retrieval. */
export async function loadAllEntriesWithBodies() {
  const metas = await listEntries();
  const out = [];
  for (const meta of metas) {
    try {
      const filePath = entryFilePath(meta.id);
      const raw = await fs.readFile(filePath, 'utf8');
      const { body } = parseEntryMarkdown(raw, meta.id);
      out.push({ meta, body });
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

/** Ensure memory directory exists on server start. */
export async function ensureMemoryStore() {
  await fs.mkdir(getMemoryDir(), { recursive: true });
  await ensureLayout();
  const config = (await readConfigJson('config.json')) ?? {};
  if (!config.memory) {
    await saveMemoryConfig(DEFAULT_MEMORY_CONFIG);
  }
}
