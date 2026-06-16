/**
 * Brain ingest stores immutable sources and returns touched page paths.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache, ensureMinnowLayout } from '../../server/config/home.js';
import { getBrainSourcesDir } from '../../server/brain/paths.js';
import { parseIngestPagesJson } from '../../server/brain/ingest.js';
import { ensureBrainStore } from '../../server/brain/store.js';

let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-ingest-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  await ensureMinnowLayout();
  await ensureBrainStore();
});

after(async () => {
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('brain ingest helpers', () => {
  test('parseIngestPagesJson extracts page plans from LLM JSON', () => {
    const raw = JSON.stringify([
      {
        relPath: 'facts/api-preference.md',
        title: 'API preference',
        body: 'Prefer OpenAI-compatible endpoints.',
        tags: ['api'],
        summary: 'API style',
      },
    ]);
    const pages = parseIngestPagesJson(raw);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].relPath, 'facts/api-preference.md');
    assert.equal(pages[0].title, 'API preference');
  });

  test('sources directory exists after brain bootstrap', async () => {
    await fs.access(getBrainSourcesDir());
  });
});
