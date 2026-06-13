/**
 * Chat app launcher copy in the OS app registry.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { APPS, getAppById } from '../../src/os/app-registry.ts';

describe('app-registry chat copy', () => {
  test('chat description matches desktop launcher card copy', () => {
    const chat = getAppById('chat');
    assert.ok(chat);
    assert.equal(chat.tag, 'Just talk to your model');
    assert.equal(chat.description, 'General assistant — tools, files, and app routing');
  });

  test('chat entry is present in APPS list', () => {
    assert.ok(APPS.some((app) => app.id === 'chat'));
  });
});
