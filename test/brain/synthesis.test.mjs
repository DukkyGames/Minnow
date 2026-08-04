/**
 * Synthesis writes wiki pages when confirmation is not required.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { writeConfigJson } from '../../server/config/store.js';
import {
  DEFAULT_SYNTHESIS_CONFIG,
  loadSynthesisConfig,
} from '../../server/brain/synthesis-config.js';
import { writeSynthesisFactPage } from '../../server/brain/synthesis.js';
import { ensureBrainStore, listPages } from '../../server/brain/store.js';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-synthesis-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
  await ensureBrainStore();
});

after(async () => {
  // Let background brain vector/anchor work finish before closing SQLite and removing MINNOW_HOME.
  await new Promise((resolve) => setTimeout(resolve, 250));
  closeCodeDbForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain synthesis defaults', () => {
  test('default synthesis config writes freely (requireConfirmation false)', async () => {
    await writeConfigJson('config.json', {});
    const cfg = await loadSynthesisConfig();
    assert.equal(cfg.requireConfirmation, false);
    assert.equal(DEFAULT_SYNTHESIS_CONFIG.requireConfirmation, false);
  });

  test('writeSynthesisFactPage creates facts page with source synthesis', async () => {
    const result = await writeSynthesisFactPage({
      title: 'Favorite editor',
      body: 'Uses VS Code for TypeScript.',
      tags: ['preference'],
    });
    assert.match(result.relPath, /^facts\/.+\.md$/);
    const pages = await listPages();
    const page = pages.find((p) => p.id === result.page.meta.id);
    assert.ok(page);
    assert.equal(page.source, 'synthesis');

    const raw = await fs.readFile(
      path.join(homeDir, 'brain', 'pages', result.relPath),
      'utf8',
    );
    assert.match(raw, /source: synthesis/);
  });
});
