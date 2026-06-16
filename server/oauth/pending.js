/**
 * Pending OAuth PKCE flows (memory + disk, 10-minute TTL).
 */

import fs from 'node:fs/promises';
import { oauthPendingPath } from './paths.js';

/** Flow TTL in milliseconds. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

/** @typedef {object} PendingOAuthFlow
 * @property {string} state
 * @property {'google' | 'microsoft'} provider
 * @property {string} codeVerifier
 * @property {{ email: boolean, calendar: boolean }} services
 * @property {string} label
 * @property {number} createdAt
 */

/** @type {Map<string, PendingOAuthFlow>} */
const memoryPending = new Map();

async function readPendingFile() {
  try {
    const raw = await fs.readFile(oauthPendingPath(), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.flows) ? data.flows : [];
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writePendingFile(flows) {
  const dir = oauthPendingPath().replace(/[/\\]pending\.json$/, '');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(oauthPendingPath(), JSON.stringify({ version: 1, flows }, null, 2), 'utf8');
}

/** Drop expired flows from memory and disk. */
export async function prunePendingFlows() {
  const now = Date.now();
  for (const [state, flow] of memoryPending.entries()) {
    if (now - flow.createdAt > PENDING_TTL_MS) {
      memoryPending.delete(state);
    }
  }

  const fromDisk = await readPendingFile();
  const fresh = fromDisk.filter((row) => now - Number(row.createdAt) <= PENDING_TTL_MS);
  for (const row of fresh) {
    if (!memoryPending.has(row.state)) {
      memoryPending.set(row.state, row);
    }
  }
  if (fresh.length !== fromDisk.length) {
    await writePendingFile(fresh);
  }
}

/**
 * Register a new pending flow.
 * @param {PendingOAuthFlow} flow
 */
export async function savePendingFlow(flow) {
  await prunePendingFlows();
  memoryPending.set(flow.state, flow);
  const flows = [...memoryPending.values()];
  await writePendingFile(flows);
}

/**
 * Consume a pending flow by state (single use).
 * @param {string} state
 */
export async function consumePendingFlow(state) {
  await prunePendingFlows();
  let flow = memoryPending.get(state) ?? null;
  if (!flow) {
    const fromDisk = await readPendingFile();
    flow = fromDisk.find((row) => row.state === state) ?? null;
  }
  if (!flow) {
    return null;
  }
  if (Date.now() - flow.createdAt > PENDING_TTL_MS) {
    memoryPending.delete(state);
    return null;
  }
  memoryPending.delete(state);
  const remaining = [...memoryPending.values()];
  await writePendingFile(remaining);
  return flow;
}

/** Reset pending state (tests). */
export function resetPendingFlowsForTests() {
  memoryPending.clear();
}
