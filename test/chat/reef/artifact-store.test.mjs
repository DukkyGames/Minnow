/**
 * Reef artifact store — append version, manifest update.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, before, after } from 'node:test';
import {
  createArtifact,
  appendArtifactVersion,
  readArtifactVersion,
  listArtifacts,
} from '../../../server/reef/artifact-store.js';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../../server/config/home.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_ID = '11111111-artifact-store';

describe('reef artifact-store', () => {
  /** @type {string} */
  let tempHome;

  before(async () => {
    tempHome = path.join(__dirname, `tmp-artifact-store-${TEST_ID}`);
    fs.rmSync(tempHome, { recursive: true, force: true });
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await ensureMinnowLayout();
  });

  after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });

  test('create and append versions monotonically', async () => {
    const created = await createArtifact({
      id: TEST_ID,
      title: 'Store test',
      body: 'body v1',
      author: 'agent',
    });
    assert.equal(created.manifest.currentVersion, 1);

    const v2 = await appendArtifactVersion(TEST_ID, {
      body: 'body v2',
      author: 'user',
      summary: 'user edit',
    });
    assert.equal(v2.version, 2);
    assert.equal(v2.manifest.currentVersion, 2);

    const row = await readArtifactVersion(TEST_ID, 2);
    assert.ok(row);
    assert.equal(row.body.trim(), 'body v2');
    assert.equal(row.meta.author, 'user');
  });

  test('listArtifacts includes created id', async () => {
    const rows = await listArtifacts({ limit: 50 });
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(TEST_ID));
  });
});
