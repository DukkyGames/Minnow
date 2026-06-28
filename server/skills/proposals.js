/**
 * Skill proposal queue persistence (~/.minnow/skills/proposals.json).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getUserSkillsRoot } from './scan.js';
import { loadSynthesisConfig } from '../memory/synthesis-config.js';

/** @typedef {'pending' | 'accepted' | 'rejected'} ProposalStatus */

/**
 * @typedef {object} SkillProposal
 * @property {string} id
 * @property {string} createdAt
 * @property {string} [sourceChatId]
 * @property {string} title
 * @property {string} skillMdDraft
 * @property {string[]} tags
 * @property {number} confidence
 * @property {string} rationale
 * @property {ProposalStatus} status
 */

const VALID_STATUSES = new Set(['pending', 'accepted', 'rejected']);

function proposalsPath() {
  return path.join(getUserSkillsRoot(), 'proposals.json');
}

/** @returns {Promise<{ version: number, proposals: SkillProposal[] }>} */
async function loadStore() {
  const filePath = proposalsPath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { version: 1, proposals: [] };
    }
    return {
      version: parsed.version ?? 1,
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { version: 1, proposals: [] };
    }
    throw err;
  }
}

/** @param {{ version: number, proposals: SkillProposal[] }} store */
async function saveStore(store) {
  const filePath = proposalsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * @param {SkillProposal[]} proposals
 * @param {number} retentionDays
 */
function pruneRejected(proposals, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return proposals.filter((p) => {
    if (p.status !== 'rejected') return true;
    const created = Date.parse(p.createdAt);
    return Number.isFinite(created) && created >= cutoff;
  });
}

/**
 * @param {SkillProposal[]} proposals
 * @param {number} maxPending
 */
function capPending(proposals, maxPending) {
  const pending = proposals.filter((p) => p.status === 'pending');
  if (pending.length <= maxPending) return proposals;

  const sorted = [...pending].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const dropIds = new Set(
    sorted.slice(0, pending.length - maxPending).map((p) => p.id),
  );
  return proposals.filter((p) => !dropIds.has(p.id));
}

/** @param {Partial<SkillProposal>} input */
function normalizeProposal(input) {
  const confidence =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? Math.min(1, Math.max(0, input.confidence))
      : 0.5;
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).slice(0, 64)).filter(Boolean)
    : [];

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    sourceChatId:
      typeof input.sourceChatId === 'string' ? input.sourceChatId : undefined,
    title: String(input.title ?? 'Untitled skill').slice(0, 200),
    skillMdDraft: String(input.skillMdDraft ?? ''),
    tags,
    confidence,
    rationale: String(input.rationale ?? '').slice(0, 500),
    status: 'pending',
  };
}

/**
 * @param {Partial<SkillProposal>} input
 * @returns {Promise<SkillProposal>}
 */
export async function addSkillProposal(input) {
  const cfg = await loadSynthesisConfig();
  const store = await loadStore();
  const proposal = normalizeProposal(input);
  store.proposals.push(proposal);
  store.proposals = pruneRejected(
    store.proposals,
    cfg.rejectedRetentionDays ?? 30,
  );
  store.proposals = capPending(
    store.proposals,
    cfg.maxPendingProposals ?? 100,
  );
  await saveStore(store);
  return proposal;
}

/**
 * @param {ProposalStatus} [status]
 * @returns {Promise<SkillProposal[]>}
 */
export async function listSkillProposals(status) {
  const cfg = await loadSynthesisConfig();
  const store = await loadStore();
  let rows = pruneRejected(store.proposals, cfg.rejectedRetentionDays ?? 30);
  if (status && VALID_STATUSES.has(status)) {
    rows = rows.filter((p) => p.status === status);
  }
  return rows.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/**
 * @param {string} id
 * @returns {Promise<SkillProposal | null>}
 */
export async function getSkillProposal(id) {
  const store = await loadStore();
  return store.proposals.find((p) => p.id === id) ?? null;
}

/**
 * @param {string} id
 * @param {ProposalStatus} status
 * @returns {Promise<SkillProposal | null>}
 */
export async function updateSkillProposalStatus(id, status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error('Invalid proposal status');
  }
  const store = await loadStore();
  const row = store.proposals.find((p) => p.id === id);
  if (!row) return null;
  if (row.status !== 'pending' && status !== row.status) {
    const err = new Error('Proposal already resolved');
    err.statusCode = 409;
    throw err;
  }
  row.status = status;
  await saveStore(store);
  return row;
}

/**
 * @param {string} id
 * @param {{ skillMdDraft?: string }} edits
 * @returns {Promise<SkillProposal | null>}
 */
export async function applySkillProposalEdits(id, edits) {
  const store = await loadStore();
  const row = store.proposals.find((p) => p.id === id);
  if (!row) return null;
  if (edits.skillMdDraft !== undefined) {
    row.skillMdDraft = String(edits.skillMdDraft);
  }
  await saveStore(store);
  return row;
}

/** @returns {Promise<number>} */
export async function countPendingSkillProposals() {
  const rows = await listSkillProposals('pending');
  return rows.length;
}

/**
 * Remove proposals by scope (`pending` keeps accepted/rejected; `all` wipes the queue).
 * @param {'pending' | 'all'} [scope]
 * @returns {Promise<{ removed: number }>}
 */
export async function clearSkillProposals(scope = 'pending') {
  const store = await loadStore();
  const before = store.proposals.length;
  if (scope === 'all') {
    store.proposals = [];
  } else {
    store.proposals = store.proposals.filter((p) => p.status !== 'pending');
  }
  await saveStore(store);
  return { removed: before - store.proposals.length };
}
