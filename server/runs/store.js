/**
 * Controller run registry + write-ahead result persistence (~/.minnow/runs/).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureMinnowLayout } from '../config/home.js';
import {
  buildResultKey,
  registryDir,
  registryFilePath,
  resultFilePath,
  resultsDir,
} from './paths.js';

/**
 * Atomic JSON write: temp file in the same directory, then rename.
 * @param {string} filePath
 * @param {unknown} data
 */
async function atomicWriteJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, filePath);
}

/** Ensure runs layout exists. */
export async function ensureRunsLayout() {
  await ensureMinnowLayout();
  await fs.mkdir(registryDir(), { recursive: true });
  await fs.mkdir(resultsDir(), { recursive: true });
}

/**
 * @returns {Promise<object[]>}
 */
export async function listRegistryRecords() {
  await ensureRunsLayout();
  let files = [];
  try {
    files = await fs.readdir(registryDir());
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }

  const records = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(registryDir(), file), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') records.push(parsed);
    } catch {
      /* skip corrupt entries */
    }
  }
  return records;
}

/**
 * @param {string} runId
 * @returns {Promise<object | null>}
 */
export async function readRegistryRecord(runId) {
  await ensureRunsLayout();
  try {
    const raw = await fs.readFile(registryFilePath(runId), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * @param {object} record
 * @returns {Promise<object>}
 */
export async function writeRegistryRecord(record) {
  if (!record || typeof record !== 'object' || !record.runId) {
    throw new Error('runId required');
  }
  await atomicWriteJson(registryFilePath(record.runId), record);
  return record;
}

/**
 * @param {string} key
 * @returns {Promise<unknown | null>}
 */
export async function readCommittedResult(key) {
  await ensureRunsLayout();
  try {
    const raw = await fs.readFile(resultFilePath(key), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * @param {string} key
 * @param {unknown} data
 * @returns {Promise<string>}
 */
export async function writeCommittedResult(key, data) {
  if (!key || typeof key !== 'string') throw new Error('result key required');
  await atomicWriteJson(resultFilePath(key), data);
  return key;
}

const TERMINAL_LIFECYCLES = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

/**
 * Mark non-terminal registry rows for the same board task with a lower attempt as superseded.
 * @param {string} boardTaskId
 * @param {number} attempt
 * @returns {Promise<number>} count of updated records
 */
export async function supersedeOlderRegistryAttempts(boardTaskId, attempt) {
  if (!boardTaskId || !Number.isFinite(attempt) || attempt <= 1) return 0;
  const records = await listRegistryRecords();
  const now = new Date().toISOString();
  let updated = 0;
  for (const record of records) {
    if (record.boardTaskId !== boardTaskId) continue;
    if ((record.attempt ?? 1) >= attempt) continue;
    if (TERMINAL_LIFECYCLES.has(record.lifecycle)) continue;
    await writeRegistryRecord({
      ...record,
      status: 'failed',
      lifecycle: 'interrupted',
      error: 'superseded',
      endedAt: now,
    });
    updated += 1;
  }
  return updated;
}

export { buildResultKey };
