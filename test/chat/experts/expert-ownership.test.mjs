import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isUserOwnedExpert } from '../../../src/chat/experts/expert-ownership.ts';

describe('expert ownership', () => {
  test('user-owned when not in builtin set', () => {
    const record = {
      meta: { id: 'my-coach', label: 'Coach', kind: 'expert', version: '1' },
      fullBody: 'body',
      source: 'user',
    };
    assert.equal(isUserOwnedExpert(record, new Set(['general'])), true);
  });

  test('builtin override is not user-owned for Lab delete', () => {
    const record = {
      meta: { id: 'general', label: 'General', kind: 'expert', version: '1' },
      fullBody: 'body',
      source: 'user',
    };
    assert.equal(isUserOwnedExpert(record, new Set(['general'])), false);
  });
});
