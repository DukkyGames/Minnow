import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  resolveTrayIconFallbackPath,
  resolveTrayIconPath,
  shouldUseTemplateTrayIcon,
} from '../../electron/tray-icon.ts';

const root = '/app/minnow';

describe('resolveTrayIconPath', () => {
  test('darwin uses menu-bar template asset', () => {
    assert.equal(
      resolveTrayIconPath('darwin', root),
      path.join(root, 'build', 'tray', 'trayTemplate.png'),
    );
  });

  test('linux uses panel tray asset', () => {
    assert.equal(
      resolveTrayIconPath('linux', root),
      path.join(root, 'build', 'tray', 'tray-linux.png'),
    );
  });

  test('win32 uses taskbar ico', () => {
    assert.equal(
      resolveTrayIconPath('win32', root),
      path.join(root, 'build', 'icon.ico'),
    );
  });

  test('unknown platforms fall back to linux tray asset', () => {
    assert.equal(
      resolveTrayIconPath('freebsd', root),
      path.join(root, 'build', 'tray', 'tray-linux.png'),
    );
  });
});

describe('resolveTrayIconFallbackPath', () => {
  test('points at the 32px logo ladder PNG', () => {
    assert.equal(
      resolveTrayIconFallbackPath(root),
      path.join(
        root,
        'public',
        'logos',
        'minnow-logo',
        'minnow',
        'png',
        'minnow-32.png',
      ),
    );
  });
});

describe('shouldUseTemplateTrayIcon', () => {
  test('darwin template asset is marked as template', () => {
    const iconPath = path.join(root, 'build', 'tray', 'trayTemplate.png');
    assert.equal(shouldUseTemplateTrayIcon('darwin', iconPath), true);
  });

  test('darwin fallback ladder PNG is not a template', () => {
    const iconPath = path.join(root, 'public', 'logos', 'minnow-logo', 'minnow', 'png', 'minnow-32.png');
    assert.equal(shouldUseTemplateTrayIcon('darwin', iconPath), false);
  });

  test('linux never uses template rendering', () => {
    const iconPath = path.join(root, 'build', 'tray', 'tray-linux.png');
    assert.equal(shouldUseTemplateTrayIcon('linux', iconPath), false);
  });
});
