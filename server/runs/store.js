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

export { buildResultKey };
