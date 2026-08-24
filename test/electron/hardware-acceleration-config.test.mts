import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHardwareAccelerationSync } from '../../electron/desktop-shell-config.ts';

// The pre-ready path: app.disableHardwareAcceleration() is a silent no-op once
// Electron is ready, so this reader must be synchronous and must never throw —
// every failure mode has to fall back to true (Electron's stock behavior).

const tempHomes: string[] = [];
const originalHome = process.env.MINNOW_HOME;

function homeWithConfig(contents: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-hwaccel-'));
  tempHomes.push(dir);
  if (contents !== null) {
    fs.writeFileSync(path.join(dir, 'config.json'), contents, 'utf8');
  }
  process.env.MINNOW_HOME = dir;
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = originalHome;
  while (tempHomes.length) {
    fs.rmSync(tempHomes.pop() as string, { recursive: true, force: true });
  }
});

describe('readHardwareAccelerationSync', () => {
  test('reads an explicit false', () => {
    homeWithConfig(JSON.stringify({ desktopShell: { hardwareAcceleration: false } }));
    assert.equal(readHardwareAccelerationSync(), false);
  });

  test('reads an explicit true', () => {
    homeWithConfig(JSON.stringify({ desktopShell: { hardwareAcceleration: true } }));
    assert.equal(readHardwareAccelerationSync(), true);
  });

  test('defaults to true when the key is absent', () => {
    homeWithConfig(JSON.stringify({ desktopShell: { closeToTray: false } }));
    assert.equal(readHardwareAccelerationSync(), true);
  });

  test('defaults to true when desktopShell is absent', () => {
    homeWithConfig(JSON.stringify({ schemaVersion: 1 }));
    assert.equal(readHardwareAccelerationSync(), true);
  });

  test('defaults to true for a non-boolean value', () => {
    homeWithConfig(JSON.stringify({ desktopShell: { hardwareAcceleration: 'off' } }));
    assert.equal(readHardwareAccelerationSync(), true);
  });

  test('defaults to true when config.json is missing', () => {
    homeWithConfig(null);
    assert.equal(readHardwareAccelerationSync(), true);
  });

  test('defaults to true on malformed JSON rather than throwing', () => {
    homeWithConfig('{ not json');
    assert.doesNotThrow(() => readHardwareAccelerationSync());
    assert.equal(readHardwareAccelerationSync(), true);
  });

  test('honours the SPEEDCHAT_HOME legacy override', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-hwaccel-legacy-'));
    tempHomes.push(dir);
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ desktopShell: { hardwareAcceleration: false } }),
      'utf8',
    );
    delete process.env.MINNOW_HOME;
    const priorLegacy = process.env.SPEEDCHAT_HOME;
    process.env.SPEEDCHAT_HOME = dir;
    try {
      assert.equal(readHardwareAccelerationSync(), false);
    } finally {
      if (priorLegacy === undefined) delete process.env.SPEEDCHAT_HOME;
      else process.env.SPEEDCHAT_HOME = priorLegacy;
    }
  });
});
