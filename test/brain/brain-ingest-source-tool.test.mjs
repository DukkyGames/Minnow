/**
 * brain_ingest_source success message uses ingestSource.pages (not legacy paths).
 *
 * Requires --experimental-test-module-mocks (included via test/run-all.mjs tsx-mocks-loader).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';

const MOCK_PAGES = ['facts/ingest-one.md', 'facts/ingest-two.md'];

mock.module('../../server/brain/ingest.js', {
  namedExports: {
    ingestSource: async () => ({
      sourcePath: 'deadbeef-notes.txt',
      pages: MOCK_PAGES,
    }),
    clearIngestSources: async () => ({ removed: 0 }),
    parseIngestPagesJson: () => [],
  },
});

const { toolBrainIngestSource } = await import('../../server/tools/brain-tools.js');

describe('toolBrainIngestSource', () => {
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-ingest-tool-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await fs.writeFile(
      path.join(homeDir, 'config.json'),
      `${JSON.stringify({ brain: { enabled: true } }, null, 2)}\n`,
      'utf8',
    );
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('reports paths from result.pages', async () => {
    const out = await toolBrainIngestSource({
      content: 'Sample source body for ingest.',
      title: 'Sample',
    });
    assert.match(out, /Ingested source into 2 page\(s\):/);
    assert.ok(MOCK_PAGES.every((p) => out.includes(p)));
    assert.doesNotMatch(out, /no wiki pages were created/i);
  });
});
