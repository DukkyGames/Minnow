/**
 * Reef artifact path resolution under MINNOW_HOME.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, before, after } from 'node:test';
import {
  getHomeReefArtifactsDir,
  isValidReefArtifactId,
  tryResolveReefArtifactPath,
  tryResolveReefArtifactsFindRoot,
} from '../../../server/reef/artifact-paths.js';
import { createArtifact } from '../../../server/reef/artifact-store.js';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../../server/config/home.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ID = '11111111-artifact-test';

describe('reef artifact-paths', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = path.join(__dirname, `tmp-artifact-paths-${TEST_ID}`);
    fs.rmSync(tempHome, { recursive: true, force: true });
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await ensureMinnowLayout();
    await createArtifact({
      id: TEST_ID,
      title: 'Static test artifact',
      body: 'version one body',
      author: 'agent',
    });
  });

  after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });

  test('isValidReefArtifactId accepts slug ids', () => {
    assert.equal(isValidReefArtifactId(TEST_ID), true);
    assert.equal(isValidReefArtifactId('../evil'), false);
  });

  test('@minnow/reef/artifacts/<id> resolves to current v1.md', () => {
    const resolved = tryResolveReefArtifactPath(`@minnow/reef/artifacts/${TEST_ID}`);
    assert.ok(resolved);
    assert.ok(resolved.endsWith(`${path.sep}v1.md`));
    assert.ok(fs.existsSync(resolved));
  });

  test('traversal in artifact id is rejected', () => {
    const resolved = tryResolveReefArtifactPath('@minnow/reef/artifacts/../../../etc/passwd');
    assert.equal(resolved, null);
  });

  test('find_files root redirects to home artifacts dir', () => {
    const root = tryResolveReefArtifactsFindRoot('*.md', '@minnow/reef/artifacts');
    assert.equal(root, getHomeReefArtifactsDir());
  });
});
