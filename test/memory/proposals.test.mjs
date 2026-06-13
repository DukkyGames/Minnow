/**
 * Memory proposal persistence and accept/reject state machine tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  addMemoryProposal,
  getMemoryProposal,
  listMemoryProposals,
  updateMemoryProposalStatus,
} from '../../server/memory/proposals.js';

describe('memory proposals', () => {
  /** @type {string} */
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-memory-proposals-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('adds and lists pending proposals', async () => {
    const row = await addMemoryProposal({
      title: 'Stack',
      body: 'Uses TypeScript strict mode',
      tags: ['prefs'],
      category: 'preference',
      confidence: 0.9,
      rationale: 'explicit',
    });
    assert.equal(row.status, 'pending');
    const pending = await listMemoryProposals('pending');
    assert.ok(pending.some((p) => p.id === row.id));
  });

  test('accept transitions status and blocks duplicate resolve', async () => {
    const row = await addMemoryProposal({
      title: 'Accept me',
      body: 'Body text',
      category: 'fact',
      confidence: 0.8,
      rationale: 'test',
    });
    const accepted = await updateMemoryProposalStatus(row.id, 'accepted');
    assert.equal(accepted?.status, 'accepted');
    await assert.rejects(
      () => updateMemoryProposalStatus(row.id, 'rejected'),
      /already resolved/,
    );
  });

  test('reject transitions status', async () => {
    const row = await addMemoryProposal({
      title: 'Reject me',
      body: 'Body',
      category: 'fact',
      confidence: 0.7,
      rationale: 'test',
    });
    const rejected = await updateMemoryProposalStatus(row.id, 'rejected');
    assert.equal(rejected?.status, 'rejected');
    const stored = await getMemoryProposal(row.id);
    assert.equal(stored?.status, 'rejected');
  });

  test('caps pending proposals at configured max', async () => {
    for (let i = 0; i < 105; i += 1) {
      await addMemoryProposal({
        title: `Row ${i}`,
        body: `Body ${i}`,
        category: 'fact',
        confidence: 0.7,
        rationale: 'cap test',
      });
    }
    const pending = await listMemoryProposals('pending');
    assert.ok(pending.length <= 100);
  });
});
