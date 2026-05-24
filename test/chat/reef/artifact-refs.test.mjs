/**
 * Artifact ref bundle cycle detection (static ids).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, before, after } from 'node:test';
import {
  createArtifact,
  getArtifactWithCurrentBody,
} from '../../../server/reef/artifact-store.js';
import { loadArtifactBundle } from '../../../src/chat/reef/artifact-context.ts';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../../server/config/home.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID_A = '11111111-ref-a';
const ID_B = '11111111-ref-b';

describe('artifact refs bundle', () => {
  /** @type {string} */
  let tempHome;
  /** @type {typeof fetch | undefined} */
  let originalFetch;

  before(async () => {
    tempHome = path.join(__dirname, 'tmp-artifact-refs');
    fs.rmSync(tempHome, { recursive: true, force: true });
    process.env.MINNOW_HOME = tempHome;
    resetMinnowHomeCache();
    await ensureMinnowLayout();

    await createArtifact({
      id: ID_B,
      title: 'B',
      body: 'body b',
      author: 'agent',
    });
    await createArtifact({
      id: ID_A,
      title: 'A',
      body: 'body a',
      author: 'agent',
      refs: [ID_B],
    });
    await appendRefsCycle();

    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      const match = url.match(/\/api\/reef\/artifacts\/([^/]+)$/);
      if (!match) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      }
      const id = decodeURIComponent(match[1]);
      const row = await getArtifactWithCurrentBody(id);
      if (!row) {
        return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      }
      return { ok: true, status: 200, json: async () => row };
    };
  });

  async function appendRefsCycle() {
    const { appendArtifactVersion } = await import('../../../server/reef/artifact-store.js');
    await appendArtifactVersion(ID_B, {
      body: 'body b v2',
      author: 'agent',
      refs: [ID_A],
    });
  }

  after(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
  });

  test('loadArtifactBundle marks ref cycle', async () => {
    const bundle = await loadArtifactBundle(ID_A, 2);
    assert.match(bundle, /## Artifact: 11111111-ref-a/);
    assert.match(bundle, /## Artifact: 11111111-ref-b/);
    assert.match(bundle, /ref cycle: 11111111-ref-a/);
  });
});
