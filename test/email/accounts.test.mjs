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
  deleteEmailAccount,
  listEmailAccounts,
  redactAccount,
  validateAccountInput,
} from '../../server/email/accounts.js';
import { createAutomation, listAutomations } from '../../server/email/automations.js';
import { emailCacheDir, emailCacheMessagesPath } from '../../server/email/paths.js';
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

describe('deleteEmailAccount', () => {
  test('removes credentials, cache, and automations for the account', async () => {
    for (const row of await listEmailAccounts()) {
      await deleteEmailAccount(row.id);
    }

    const primary = await createEmailAccount(
      {
        label: 'Primary',
        username: 'primary@example.com',
        imap: { host: 'imap.example.com', port: 993, tls: true },
        isDefault: true,
      },
      'primary-password',
    );
    const secondary = await createEmailAccount(
      {
        label: 'Secondary',
        username: 'secondary@example.com',
        imap: { host: 'imap.example.com', port: 993, tls: true },
      },
      'secondary-password',
    );

    await fs.mkdir(emailCacheDir(primary.id), { recursive: true });
    await fs.writeFile(emailCacheMessagesPath(primary.id), '{"messages":[]}\n', 'utf8');
    await createAutomation({
      name: 'Triage primary',
      accountId: primary.id,
      trigger: 'on_new_message',
      action: 'triage',
    });

    await deleteEmailAccount(primary.id);

    const remaining = await listEmailAccounts();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, secondary.id);
    assert.equal(remaining[0].isDefault, true);

    const rules = await listAutomations();
    assert.equal(rules.length, 0);

    await assert.rejects(fs.stat(emailCacheDir(primary.id)), /ENOENT/);
  });
});
