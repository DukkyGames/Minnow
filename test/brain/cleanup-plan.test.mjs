/**
 * Brain wiki cleanup plan — snapshot + mocked LLM.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { getBrainCleanupDir } from '../../server/brain/paths.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { createPage, ensureBrainStore } from '../../server/brain/store.js';
import {
  cleanupPlanDeps,
  generateBrainCleanupPlan,
  parseCleanupPlanJson,
} from '../../server/brain/cleanup/plan.js';
import { buildWikiCleanupSnapshot, pathsFromDiagnostics } from '../../server/brain/cleanup/snapshot.js';
import { collectWikiDiagnostics } from '../../server/brain/lint.js';

const PAGE_A = '11111111-1111-1111-1111-111111111111';
const PAGE_B = '22222222-2222-2222-2222-222222222222';

const MOCK_PLAN = {
  planVersion: 1,
  planMarkdown: '## Overview\nReview orphans before deleting.',
  summary: {
    deletes: [{ path: 'facts/orphan-note.md', reason: 'No inbound links' }],
    merges: [],
    linkFixes: [],
    staleActions: [],
    anchorDrift: [],
    risks: [{ summary: 'May remove useful notes', mitigation: 'Manual review' }],
  },
};

let homeDir;
/** @type {typeof cleanupPlanDeps.llmCall} */
let originalLlmCall;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-cleanup-plan-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
  const configPath = path.join(homeDir, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.memory.embeddings.enabled = false;
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await ensureBrainStore();

  await createPage({
    relPath: 'facts/orphan-note.md',
    id: PAGE_A,
    title: 'Orphan',
    body: 'No inbound links.',
    source: 'user',
    skipVectorSync: true,
  });
  await createPage({
    relPath: 'facts/linked-note.md',
    id: PAGE_B,
    title: 'Linked',
    body: 'See [[facts/orphan-note]].',
    source: 'user',
    skipVectorSync: true,
  });

  originalLlmCall = cleanupPlanDeps.llmCall;
  cleanupPlanDeps.llmCall = async () => JSON.stringify(MOCK_PLAN);
});

after(async () => {
  cleanupPlanDeps.llmCall = originalLlmCall;
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain cleanup plan', () => {
  test('parseCleanupPlanJson accepts planVersion 1 payload', () => {
    const parsed = parseCleanupPlanJson(JSON.stringify(MOCK_PLAN));
    assert.equal(parsed?.planVersion, 1);
    assert.match(String(parsed?.planMarkdown), /Overview/);
    assert.equal(parsed?.summary?.deletes?.length, 1);
  });

  test('buildWikiCleanupSnapshot includes catalog and diagnostics', async () => {
    const diagnostics = await collectWikiDiagnostics();
    const { snapshot, snapshotHash } = await buildWikiCleanupSnapshot({ diagnostics });
    assert.ok(snapshotHash.length === 64);
    assert.equal(snapshot.pageCount, 2);
    assert.ok(Array.isArray(snapshot.catalog));
    assert.equal(snapshot.catalog.length, 2);
    assert.ok(snapshot.diagnostics);
    assert.ok(typeof snapshot.schemaExcerpt === 'string');
    assert.ok(snapshot.bodies['facts/orphan-note.md']);
  });

  test('pathsFromDiagnostics collects diagnostic page paths', async () => {
    const diagnostics = await collectWikiDiagnostics();
    const paths = pathsFromDiagnostics(diagnostics);
    for (const row of diagnostics.orphans) {
      assert.ok(paths.has(row.path));
    }
    for (const row of diagnostics.missingLinks) {
      assert.ok(paths.has(row.from));
    }
  });

  test('generateBrainCleanupPlan persists plan under .cleanup', async () => {
    const result = await generateBrainCleanupPlan({
      providerId: 'test-provider',
      modelId: 'test-model',
    });
    assert.ok(result.planId);
    assert.ok(result.createdAt);
    assert.equal(result.plan.planVersion, 1);
    assert.match(result.plan.planMarkdown, /Overview/);
    assert.equal(result.snapshotHash.length, 64);
    assert.ok(Array.isArray(result.diagnostics.orphans));

    const filePath = path.join(getBrainCleanupDir(), `${result.planId}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    const persisted = JSON.parse(raw);
    assert.equal(persisted.planId, result.planId);
    assert.equal(persisted.snapshotHash, result.snapshotHash);
    assert.deepEqual(persisted.plan.summary.deletes, MOCK_PLAN.summary.deletes);
  });

  test('generateBrainCleanupPlan requires providerId and modelId', async () => {
    await assert.rejects(
      () => generateBrainCleanupPlan({ providerId: '', modelId: 'm' }),
      /providerId and modelId are required/,
    );
  });
});
