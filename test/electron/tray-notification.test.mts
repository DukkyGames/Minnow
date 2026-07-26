/**
 * One-time close notification hint persistence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  markCloseNotificationShown,
  readCloseNotificationShown,
} from '../../electron/tray-hints.ts';

const prevHome = process.env.MINNOW_HOME;

afterEach(() => {
  if (prevHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = prevHome;
});

describe('tray close notification hint', () => {
  test('starts false then persists after mark', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-tray-hint-'));
    process.env.MINNOW_HOME = dir;
    assert.equal(readCloseNotificationShown(), false);
    markCloseNotificationShown();
    assert.equal(readCloseNotificationShown(), true);
  });
});
