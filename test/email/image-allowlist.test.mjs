/**
 * Per-sender remote-image allowlist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

let tempHome = '';
const originalHome = process.env.MINNOW_HOME;

const {
  allowImagesFromSender,
  blockImagesFromSender,
  isSenderAllowed,
  listImageAllowlist,
  normalizeSender,
} = await import('../../server/email/image-allowlist.js');

describe('normalizeSender', () => {
  test('reduces a From header to a bare comparable address', () => {
    assert.equal(normalizeSender('"Acme News" <News@Acme.COM>'), 'news@acme.com');
    assert.equal(normalizeSender('  Plain@Example.com '), 'plain@example.com');
    assert.equal(normalizeSender(''), '');
    assert.equal(normalizeSender(null), '');
  });
});

describe('image allowlist', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-allowlist-'));
    process.env.MINNOW_HOME = tempHome;
    await fs.mkdir(path.join(tempHome, 'email'), { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  test('starts empty and blocks every sender', async () => {
    assert.deepEqual(await listImageAllowlist(), []);
    assert.equal(await isSenderAllowed('news@acme.com'), false);
  });

  test('allowing a sender persists and matches regardless of header form', async () => {
    await allowImagesFromSender('"Acme News" <News@Acme.COM>');

    assert.deepEqual(await listImageAllowlist(), ['news@acme.com']);
    assert.equal(await isSenderAllowed('news@acme.com'), true);
    // The same correspondent, written differently, is still trusted.
    assert.equal(await isSenderAllowed('<NEWS@acme.com>'), true);
  });

  test('allowing twice does not duplicate the entry', async () => {
    await allowImagesFromSender('news@acme.com');
    await allowImagesFromSender('News@Acme.com');

    assert.deepEqual(await listImageAllowlist(), ['news@acme.com']);
  });

  test('blocking removes the sender again', async () => {
    await allowImagesFromSender('news@acme.com');
    await blockImagesFromSender('news@acme.com');

    assert.deepEqual(await listImageAllowlist(), []);
    assert.equal(await isSenderAllowed('news@acme.com'), false);
  });

  test('an empty sender is rejected rather than stored', async () => {
    await assert.rejects(() => allowImagesFromSender('   '), /sender is required/);
    assert.deepEqual(await listImageAllowlist(), []);
  });

  test('trusting one sender does not trust another', async () => {
    await allowImagesFromSender('news@acme.com');
    assert.equal(await isSenderAllowed('tracker@evil.example'), false);
  });
});
