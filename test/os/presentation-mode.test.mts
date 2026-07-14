import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolvePresentationMode } from '../../src/os/presentation-mode.ts';

describe('presentation-mode', () => {
  test('settings from Code launches fullscreen', () => {
    assert.equal(resolvePresentationMode('settings', { returnToApp: 'code' }), 'fullscreen');
  });

  test('settings without return target stays windowed', () => {
    assert.equal(resolvePresentationMode('settings'), 'window');
  });
});
