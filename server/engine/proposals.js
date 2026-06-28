/**
 * Proposal queue persistence (proposals.json under injected rootDir).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** @typedef {'identity' | 'preference' | 'fact' | 'contact' | 'project' | 'goal'} MemoryCategory */
/** @typedef {'pending' | 'accepted' | 'rejected'} ProposalStatus */

/**
 * @typedef {object} MemoryProposal
 * @property {string} id
 * @property {string} createdAt
 * @property {string} [sourceChatId]
 * @property {string} [sourceExcerpt]
 * @property {string} title
 * @property {string} body
 * @property {string[]} tags
 * @property {MemoryCategory} category
 * @property {number} confidence
 * @property {string} rationale
 * @property {ProposalStatus} status
 */

/**
 * @typedef {{ rootDir: string, vectorsPath: string, proposalsPath: string, backupsDir: string }} EnginePaths
 */

const VALID_CATEGORIES = new Set([
  'identity',
  'preference',
  'fact',
  'contact',
  'project',
  'goal',
]);

const VALID_STATUSES = new Set(['pending', 'accepted', 'rejected']);

/**
 * Create path-parameterized proposal store API.
 * @param {() => EnginePaths} getPaths
 * @param {{ loadSynthesisConfig: () => Promise<object> }} deps
 */
export function createProposals(getPaths, deps) {
  /** @returns {Promise<{ version: number, proposals: MemoryProposal[] }>} */
  async function loadStore() {
    const filePath = getPaths().proposalsPath;
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

  /** @param {{ version: number, proposals: MemoryProposal[] }} store */
  async function saveStore(store) {
    const filePath = getPaths().proposalsPath;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, filePath);
  }

  /**
   * Drop rejected proposals older than retention window.
   * @param {MemoryProposal[]} proposals
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
   * Cap pending proposals by dropping oldest pending entries.
   * @param {MemoryProposal[]} proposals
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

  /** @param {Partial<MemoryProposal>} input */
  function normalizeProposal(input) {
    const category = VALID_CATEGORIES.has(input.category)
      ? input.category
      : 'fact';
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
      sourceExcerpt:
        typeof input.sourceExcerpt === 'string'
          ? input.sourceExcerpt.slice(0, 2000)
          : undefined,
      title: String(input.title ?? 'Untitled').slice(0, 200),
      body: String(input.body ?? '').slice(0, 32_000),
      tags,
      category,
      confidence,
      rationale: String(input.rationale ?? '').slice(0, 500),
      status: 'pending',
    };
  }

  /**
   * @param {Partial<MemoryProposal>} input
   * @returns {Promise<MemoryProposal>}
   */
  async function addMemoryProposal(input) {
    const cfg = await deps.loadSynthesisConfig();
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
   * @returns {Promise<MemoryProposal[]>}
   */
  async function listMemoryProposals(status) {
    const cfg = await deps.loadSynthesisConfig();
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
   * @returns {Promise<MemoryProposal | null>}
   */
  async function getMemoryProposal(id) {
    const store = await loadStore();
    return store.proposals.find((p) => p.id === id) ?? null;
  }

  /**
   * @param {string} id
   * @param {ProposalStatus} status
   * @returns {Promise<MemoryProposal | null>}
   */
  async function updateMemoryProposalStatus(id, status) {
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
   * @param {{ title?: string, body?: string, tags?: string[] }} edits
   * @returns {Promise<MemoryProposal | null>}
   */
  async function applyMemoryProposalEdits(id, edits) {
    const store = await loadStore();
    const row = store.proposals.find((p) => p.id === id);
    if (!row) return null;
    if (edits.title !== undefined) {
      row.title = String(edits.title).slice(0, 200);
    }
    if (edits.body !== undefined) {
      row.body = String(edits.body).slice(0, 32_000);
    }
    if (edits.tags !== undefined && Array.isArray(edits.tags)) {
      row.tags = edits.tags.map((t) => String(t).slice(0, 64)).filter(Boolean);
    }
    await saveStore(store);
    return row;
  }

  /** @returns {Promise<number>} */
  async function countPendingMemoryProposals() {
    const rows = await listMemoryProposals('pending');
    return rows.length;
  }

  /**
   * Remove proposals by scope (`pending` keeps accepted/rejected; `all` wipes the queue).
   * @param {'pending' | 'all'} [scope]
   * @returns {Promise<{ removed: number }>}
   */
  async function clearMemoryProposals(scope = 'pending') {
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

  return {
    addMemoryProposal,
    listMemoryProposals,
    getMemoryProposal,
    updateMemoryProposalStatus,
    applyMemoryProposalEdits,
    countPendingMemoryProposals,
    clearMemoryProposals,
  };
}
