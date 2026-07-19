/**
 * Install an agent pack from an uploaded zip archive.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { packDirectoryPath, PACK_ID_RE } from './paths.js';
import { shouldExposePackDir } from './validate.js';
import { readZipEntries } from './zip.js';

/** Max zip upload size for agent packs (10 MB). */
export const AGENT_PACK_ZIP_MAX_BYTES = 10 * 1024 * 1024;

/** Max number of entries inside one zip. */
export const AGENT_PACK_ZIP_MAX_ENTRIES = 500;

/** Max size for a single extracted file (2 MB). */
export const AGENT_PACK_MAX_FILE_BYTES = 2 * 1024 * 1024;

const SKIP_ENTRY_PREFIXES = ['__macosx/', '.ds_store'];

/**
 * @typedef {{ packId: string, filesWritten: number, packRoot: string }} AgentPackInstallResult
 */

/**
 * Parse zip bytes, detect the pack layout, and write files under ~/.minnow/agent-packs/<id>/.
 * @param {Buffer} zipBuffer
 * @returns {Promise<AgentPackInstallResult>}
 */
export async function installAgentPackFromZip(zipBuffer) {
  const entries = readZipEntries(zipBuffer);
  if (!entries.length) {
    throw new Error('Zip archive is empty');
  }
  if (entries.length > AGENT_PACK_ZIP_MAX_ENTRIES) {
    throw new Error(`Zip exceeds ${AGENT_PACK_ZIP_MAX_ENTRIES} entry limit`);
  }

  const manifestEntry = findManifestEntry(entries);
  const manifest = parseManifestBuffer(manifestEntry.data);
  const packId = String(manifest.id ?? '').trim();

  if (!PACK_ID_RE.test(packId)) {
    throw new Error('manifest.json id must match ^[a-z][a-z0-9-]{0,63}$');
  }
  if (!shouldExposePackDir(packId)) {
    throw new Error('Pack ids starting with _ are reserved');
  }

  const prefix = manifestPrefix(manifestEntry.path);
  const filesToWrite = collectPackFiles(entries, prefix);

  if (!filesToWrite.has('manifest.json')) {
    throw new Error('manifest.json is required at the pack root');
  }

  const packRoot = packDirectoryPath(packId);
  await fs.mkdir(packRoot, { recursive: true });

  let filesWritten = 0;
  for (const [relPath, data] of filesToWrite) {
    if (data.length > AGENT_PACK_MAX_FILE_BYTES) {
      throw new Error(`File ${relPath} exceeds ${AGENT_PACK_MAX_FILE_BYTES} byte limit`);
    }
    const target = path.join(packRoot, relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    filesWritten += 1;
  }

  return { packId, filesWritten, packRoot };
}

/**
 * @param {import('./zip.js').ZipEntry[]} entries
 */
function findManifestEntry(entries) {
  /** @type {import('./zip.js').ZipEntry[]} */
  const candidates = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (shouldSkipEntry(entry.path)) continue;
    if (entry.path === 'manifest.json' || entry.path.endsWith('/manifest.json')) {
      candidates.push(entry);
    }
  }

  if (!candidates.length) {
    throw new Error('No manifest.json found in zip (expected at root or inside one folder)');
  }
  if (candidates.length > 1) {
    throw new Error('Zip must contain exactly one agent pack (multiple manifest.json files found)');
  }

  return candidates[0];
}

/**
 * @param {string} manifestPath
 */
function manifestPrefix(manifestPath) {
  if (manifestPath === 'manifest.json') return '';
  const dir = manifestPath.slice(0, manifestPath.length - 'manifest.json'.length);
  return dir.endsWith('/') ? dir : `${dir}/`;
}

/**
 * @param {import('./zip.js').ZipEntry[]} entries
 * @param {string} prefix
 * @returns {Map<string, Buffer>}
 */
function collectPackFiles(entries, prefix) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (shouldSkipEntry(entry.path)) continue;

    let relPath = entry.path;
    if (prefix) {
      if (!relPath.startsWith(prefix)) continue;
      relPath = relPath.slice(prefix.length);
    }

    if (!relPath || relPath.includes('..')) {
      throw new Error('Invalid path inside agent pack zip');
    }

    files.set(relPath, entry.data);
  }

  return files;
}

/**
 * @param {string} entryPath
 */
function shouldSkipEntry(entryPath) {
  const lower = entryPath.toLowerCase();
  for (const skip of SKIP_ENTRY_PREFIXES) {
    if (lower === skip || lower.startsWith(skip)) return true;
  }
  if (lower.endsWith('/.ds_store') || lower === '.ds_store') return true;
  return false;
}

/**
 * @param {Buffer} data
 */
function parseManifestBuffer(data) {
  let parsed;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw new Error('manifest.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('manifest.json must be a JSON object');
  }
  return parsed;
}
