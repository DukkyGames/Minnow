/**
 * Standalone Chat app was removed from the OS registry (workspace-first shell).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { APPS, getAppById } from '../../src/os/app-registry.ts';

describe('app-registry chat copy', () => {
  test('chat is not a launcher app entry', () => {
    assert.equal(getAppById('chat'), undefined);
    assert.equal(APPS.some((app) => app.id === 'chat'), false);
  });
});
