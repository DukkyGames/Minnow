/**
 * Persisted Brain wiki cleanup plans (~/.minnow/brain/.cleanup/<planId>.json).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getBrainDir } from '../paths.js';

/** Safe plan id for filesystem storage. */
const PLAN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Directory for cleanup plan snapshots. */
export function getCleanupPlansDir() {
  return path.join(getBrainDir(), '.cleanup');
}

/**
 * @param {string} planId
 * @returns {string}
 */
export function cleanupPlanFilePath(planId) {
  const id = String(planId ?? '').trim();
  if (!PLAN_ID_RE.test(id)) {
    const err = new Error('Invalid plan id');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }
  return path.join(getCleanupPlansDir(), `${id}.json`);
}

/**
 * Load a persisted cleanup plan (compatible with cleanup/plan.js writer).
 * @param {string} planId
 * @returns {Promise<{
 *   planId: string,
 *   planVersion?: number,
 *   createdAt?: string,
 *   providerId?: string,
 *   modelId?: string,
 *   diagnostics?: unknown,
 *   snapshotHash?: string,
 *   plan?: Record<string, unknown>,
 *   planMarkdown: string,
 *   summary?: Record<string, unknown>,
 * }>}
 */
export async function loadCleanupPlan(planId) {
  const filePath = cleanupPlanFilePath(planId);
  const id = String(planId ?? '').trim();

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && /** @type {{ code?: string }} */ (err).code === 'ENOENT') {
      const notFound = new Error('Cleanup plan not found');
      /** @type {Error & { statusCode?: number }} */ (notFound).statusCode = 404;
      throw notFound;
    }
    throw err;
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    const bad = new Error('Cleanup plan file is not valid JSON');
    /** @type {Error & { statusCode?: number }} */ (bad).statusCode = 422;
    throw bad;
  }

  const nested = doc?.plan && typeof doc.plan === 'object' ? doc.plan : {};
  const planMarkdown = String(
    doc.planMarkdown ?? nested.planMarkdown ?? nested.markdown ?? '',
  ).trim();

  if (!planMarkdown) {
    const missing = new Error('Cleanup plan is missing planMarkdown');
    /** @type {Error & { statusCode?: number }} */ (missing).statusCode = 422;
    throw missing;
  }

  return {
    planId: String(doc.planId ?? id),
    planVersion: typeof doc.planVersion === 'number' ? doc.planVersion : nested.planVersion,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : undefined,
    providerId: typeof doc.providerId === 'string' ? doc.providerId : undefined,
    modelId: typeof doc.modelId === 'string' ? doc.modelId : undefined,
    diagnostics: doc.diagnostics,
    snapshotHash: typeof doc.snapshotHash === 'string' ? doc.snapshotHash : undefined,
    plan: typeof doc.plan === 'object' && doc.plan ? doc.plan : undefined,
    summary:
      doc.summary && typeof doc.summary === 'object'
        ? doc.summary
        : nested.summary && typeof nested.summary === 'object'
          ? nested.summary
          : undefined,
    planMarkdown,
  };
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ planId: string, path: string }>}
 */
export async function saveCleanupPlan(payload) {
  const planId = String(payload.planId ?? '').trim();
  if (!PLAN_ID_RE.test(planId)) {
    const err = new Error('Invalid plan id');
    /** @type {Error & { statusCode?: number }} */ (err).statusCode = 400;
    throw err;
  }
  const dir = getCleanupPlansDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${planId}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { planId, path: filePath };
}
