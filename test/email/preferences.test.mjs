/**
 * Global email reader/privacy preferences.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

let tempHome = '';
const originalHome = process.env.MINNOW_HOME;

const { getEmailPreferences, updateEmailPreferences } = await import('../../server/email/preferences.js');

describe('email preferences', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-email-prefs-'));
    process.env.MINNOW_HOME = tempHome;
    await fs.mkdir(path.join(tempHome, 'email'), { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  test('defaults to blocking remote images until the user opts in', async () => {
    assert.deepEqual(await getEmailPreferences(), { alwaysLoadRemoteImages: false });
  });

  test('persists the always-load-remote-images opt-in', async () => {
    const saved = await updateEmailPreferences({ alwaysLoadRemoteImages: true });
    assert.deepEqual(saved, { alwaysLoadRemoteImages: true });
    assert.deepEqual(await getEmailPreferences(), { alwaysLoadRemoteImages: true });
  });

  test('can turn the global opt-in off again', async () => {
    await updateEmailPreferences({ alwaysLoadRemoteImages: true });
    const saved = await updateEmailPreferences({ alwaysLoadRemoteImages: false });
    assert.deepEqual(saved, { alwaysLoadRemoteImages: false });
    assert.deepEqual(await getEmailPreferences(), { alwaysLoadRemoteImages: false });
  });

  test('ignores unknown fields and coerces truthy values strictly', async () => {
    const saved = await updateEmailPreferences({
      // @ts-expect-error exercising runtime normalization
      alwaysLoadRemoteImages: 'yes',
    });
    assert.deepEqual(saved, { alwaysLoadRemoteImages: false });
  });
});
