/**
 * Leftover ~/.minnow/runs/registry/ READS only (P8-G).
 *
 * Existing files are left in place and never imported into the journal
 * (no last-write-wins). There is no writer — PUT/POST return 410 in middleware.
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

/** Ensure runs layout exists so leftover reads do not throw ENOENT. */
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

export { buildResultKey };
