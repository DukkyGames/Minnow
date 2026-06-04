import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dedupeExpertId,
  isValidExpertId,
  slugifyExpertLabel,
} from '../../../src/chat/experts/create-expert-slug.ts';

describe('create-expert-slug', () => {
  test('slugifyExpertLabel produces valid ids', () => {
    assert.equal(slugifyExpertLabel('Patent Attorney'), 'patent-attorney');
    assert.ok(isValidExpertId(slugifyExpertLabel('Patent Attorney')));
  });

  test('dedupeExpertId appends suffix on collision', () => {
    const existing = new Set(['patent-attorney']);
    assert.equal(dedupeExpertId('patent-attorney', existing), 'patent-attorney-2');
  });

  test('reserved ids are invalid', () => {
    assert.equal(isValidExpertId('general'), false);
    assert.equal(isValidExpertId('_template'), false);
  });
});
