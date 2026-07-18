/**
 * Skill observation log (~/.minnow/skills/observations.json).
 *
 * A candidate skill seen in one session is not evidence of a reusable procedure —
 * it is one data point. Observations park those data points until the same kind
 * of problem shows up in a *different* session, which is what turns "something
 * that happened once" into "something worth a skill".
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getUserSkillsRoot } from './scan.js';
import { TITLE_STOP, titleKeywords } from '../brain/synthesis.js';

/** @typedef {'open' | 'proposed'} ObservationStatus */

/**
 * @typedef {object} SkillObservation
 * @property {string} id
 * @property {string} createdAt
 * @property {string} [sourceChatId]
 * @property {string} title
 * @property {string} problem
 * @property {string} solution
 * @property {string[]} steps
 * @property {string[]} tags
 * @property {number} confidence
 * @property {ObservationStatus} status
 */

/** Default match bar for "these two observations are the same problem class". */
export const DEFAULT_MATCH_THRESHOLD = 0.5;

function observationsPath() {
  return path.join(getUserSkillsRoot(), 'observations.json');
}

/** @returns {Promise<{ version: number, observations: SkillObservation[] }>} */
async function loadStore() {
  const filePath = observationsPath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { version: 1, observations: [] };
    }
    return {
      version: parsed.version ?? 1,
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { version: 1, observations: [] };
    }
    throw err;
  }
}

/** @param {{ version: number, observations: SkillObservation[] }} store */
async function saveStore(store) {
  const filePath = observationsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * Drop observations older than the retention window.
 * @param {SkillObservation[]} observations
 * @param {number} retentionDays
 * @returns {SkillObservation[]}
 */
export function pruneObservations(observations, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return observations.filter((row) => {
    const created = Date.parse(row?.createdAt ?? '');
    return Number.isFinite(created) && created >= cutoff;
  });
}

/**
 * Keyword set for matching: title keywords plus tag keywords.
 * @param {{ title?: string, tags?: string[] }} candidate
 * @returns {Set<string>}
 */
export function observationKeywords(candidate) {
  const keys = titleKeywords(candidate?.title ?? '');
  for (const tag of candidate?.tags ?? []) {
    for (const word of String(tag).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
      if (word.length > 2 && !TITLE_STOP.has(word)) keys.add(word);
    }
  }
  return keys;
}

/**
 * Jaccard similarity over title+tag keywords.
 *
 * Keyword overlap only in v1 — embeddings would be better at catching two
 * phrasings of the same problem, but they're optional in this app and a skill
 * gate that silently stops working when embeddings are off is worse than a
 * blunter one that always works.
 *
 * @param {{ title?: string, tags?: string[] }} a
 * @param {{ title?: string, tags?: string[] }} b
 * @returns {number} 0-1
 */
export function matchScore(a, b) {
  const kA = observationKeywords(a);
  const kB = observationKeywords(b);
  if (kA.size === 0 || kB.size === 0) return 0;
  let shared = 0;
  for (const k of kA) if (kB.has(k)) shared++;
  const union = kA.size + kB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * @param {Partial<SkillObservation>} input
 * @returns {SkillObservation}
 */
function normalizeObservation(input) {
  const confidence =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? Math.min(1, Math.max(0, input.confidence))
      : 0.5;
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sourceChatId:
      typeof input.sourceChatId === 'string' ? input.sourceChatId : undefined,
    title: String(input.title ?? 'Untitled').slice(0, 200),
    problem: String(input.problem ?? '').slice(0, 2000),
    solution: String(input.solution ?? '').slice(0, 2000),
    steps: Array.isArray(input.steps)
      ? input.steps.map((s) => String(s).slice(0, 500)).filter(Boolean).slice(0, 20)
      : [],
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).slice(0, 64)).filter(Boolean).slice(0, 12)
      : [],
    confidence,
    status: 'open',
  };
}

/**
 * @param {Partial<SkillObservation>} input
 * @param {{ retentionDays?: number }} [opts]
 * @returns {Promise<SkillObservation>}
 */
export async function addSkillObservation(input, opts = {}) {
  const store = await loadStore();
  const observation = normalizeObservation(input);
  store.observations.push(observation);
  store.observations = pruneObservations(
    store.observations,
    opts.retentionDays ?? 45,
  );
  await saveStore(store);
  return observation;
}

/**
 * @param {{ retentionDays?: number }} [opts]
 * @returns {Promise<SkillObservation[]>}
 */
export async function listOpenObservations(opts = {}) {
  const store = await loadStore();
  return pruneObservations(store.observations, opts.retentionDays ?? 45).filter(
    (row) => row.status === 'open',
  );
}

/**
 * Open observations describing the same problem class as `candidate`.
 * @param {{ title?: string, tags?: string[] }} candidate
 * @param {number} [threshold]
 * @param {{ retentionDays?: number }} [opts]
 * @returns {Promise<SkillObservation[]>}
 */
export async function findMatchingObservations(
  candidate,
  threshold = DEFAULT_MATCH_THRESHOLD,
  opts = {},
) {
  const open = await listOpenObservations(opts);
  return open.filter((row) => matchScore(candidate, row) >= threshold);
}

/**
 * Count how many *distinct sessions* a set of observations spans.
 *
 * The gate is per-session, not per-observation: the same chat hitting the same
 * problem three times is still one occurrence. Observations with no chat id each
 * count once, since they can't be proven to share a session.
 *
 * @param {SkillObservation[]} observations
 * @returns {number}
 */
export function countDistinctSessions(observations) {
  const seen = new Set();
  let anonymous = 0;
  for (const row of observations) {
    if (row?.sourceChatId) seen.add(row.sourceChatId);
    else anonymous += 1;
  }
  return seen.size + anonymous;
}

/**
 * Mark observations as consumed by a proposal so they stop counting toward
 * future recurrence gates.
 * @param {string[]} ids
 * @returns {Promise<number>} how many rows changed
 */
export async function markObservationsProposed(ids) {
  const wanted = new Set(ids ?? []);
  if (wanted.size === 0) return 0;
  const store = await loadStore();
  let changed = 0;
  for (const row of store.observations) {
    if (wanted.has(row.id) && row.status !== 'proposed') {
      row.status = 'proposed';
      changed += 1;
    }
  }
  if (changed > 0) await saveStore(store);
  return changed;
}

/**
 * Drop every observation (used by Brain data clearing).
 * @returns {Promise<{ removed: number }>}
 */
export async function clearSkillObservations() {
  const store = await loadStore();
  const removed = store.observations.length;
  store.observations = [];
  await saveStore(store);
  return { removed };
}
