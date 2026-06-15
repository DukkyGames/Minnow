/**
 * Email account validation and redaction tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  createEmailAccount,
  listEmailAccounts,
  redactAccount,
  validateAccountInput,
} from '../../server/email/accounts.js';
import { resetSecretBoxCacheForTests, setSecretKeyBytesForTests } from '../../server/security/secret-box.js';

/** @type {string} */
let homeDir;

before(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-email-accounts-'));
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  setSecretKeyBytesForTests(Buffer.from('cccccccccccccccccccccccccccccccc', 'utf8'));
});

after(async () => {
  resetSecretBoxCacheForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe('validateAccountInput', () => {
  test('rejects invalid IMAP port', () => {
    assert.throws(
      () =>
        validateAccountInput({
          label: 'Test',
          username: 'user@example.com',
          imap: { host: 'imap.example.com', port: 70000, tls: true },
        }),
      /port must be between 1 and 65535/,
    );
  });

  test('accepts valid account fields', () => {
    const result = validateAccountInput({
      label: 'Work',
      username: 'user@example.com',
      imap: { host: 'imap.example.com', port: 993, tls: true },
      pollingIntervalMinutes: 3,
    });
    assert.equal(result.label, 'Work');
    assert.equal(result.pollingIntervalMinutes, 5);
  });
});

describe('account API redaction', () => {
  test('create and list never return password fields', async () => {
    const created = await createEmailAccount(
      {
        label: 'Fixture',
        username: 'fixture@example.com',
        imap: { host: 'imap.example.com', port: 993, tls: true },
      },
      'super-secret-password',
    );

    const redacted = redactAccount(created);
    assert.equal(redacted.hasPassword, true);
    assert.equal('password' in redacted, false);
    assert.equal('secretRef' in redacted, false);

    const listed = await listEmailAccounts();
    assert.equal(listed.length, 1);
    const fromList = redactAccount(listed[0]);
    assert.equal(fromList.hasPassword, true);
    assert.equal(JSON.stringify(fromList).includes('super-secret-password'), false);
  });
});
