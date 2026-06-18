/**
 * Brain wiki server tool handlers — write/search round-trip and workspace scoping.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';
import { initBrainApi } from '../../server/brain/routes.js';
import { shutdownAllLsp } from '../../server/lsp/manager.js';
import { readPage } from '../../server/brain/store.js';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';

const PAGE_PATH = 'facts/tool-roundtrip.md';

describe('brain wiki tools', () => {
  let homeDir;
  let workspaceDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-tools-'));
    workspaceDir = path.join(homeDir, 'fixture-workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await initBrainApi();
    await setWorkspaceRoot(workspaceDir);
  });

  after(async () => {
    shutdownAllLsp();
    closeCodeDbForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('brain_write_page creates a facts page and brain_search returns it', async () => {
    const writeOut = await executeServerTool('brain_write_page', {
      path: PAGE_PATH,
      title: 'Tool roundtrip note',
      body: 'Unique MIN_B4_MARKER phrase for hybrid search.',
      tags: ['testing'],
    });
    assert.match(writeOut.result, /Created wiki page "Tool roundtrip note"/);

    const row = await readPage(PAGE_PATH);
    assert.equal(row.meta.title, 'Tool roundtrip note');
    assert.match(row.body, /MIN_B4_MARKER/);

    const searchOut = await executeServerTool('brain_search', {
      query: 'MIN_B4_MARKER roundtrip',
      limit: 5,
    });
    assert.match(searchOut.result, /MIN_B4_MARKER/);
    assert.ok(searchOut.result.includes(row.meta.id));
  });

  it('brain_read_page returns page content by path', async () => {
    const out = await executeServerTool('brain_read_page', {
      path: 'facts/tool-roundtrip.md',
    });
    assert.match(out.result, /Tool roundtrip note/);
    assert.match(out.result, /MIN_B4_MARKER/);
  });

  it('brain_list returns a JSON tree', async () => {
    const out = await executeServerTool('brain_list', {});
    const tree = JSON.parse(out.result);
    assert.ok(tree && typeof tree === 'object');
    assert.ok(tree.facts);
  });

  it('brain_append_log appends to log.md', async () => {
    const out = await executeServerTool('brain_append_log', {
      entry: 'MIN-B4 test append',
    });
    assert.match(out.result, /Appended to brain log/);
  });
});
