/**
 * Reply variant JSON parser tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseReplyVariantsJson } from '../../server/email/agent.js';

const VARIANTS_FIXTURE = `[
  {"label": "Brief yes", "body": "Sounds good, I'll be there."},
  {"label": "Ask details", "body": "Could you share the agenda and time?"}
]`;

describe('parseReplyVariantsJson', () => {
  test('parses variant array fixture', () => {
    const parsed = parseReplyVariantsJson(VARIANTS_FIXTURE);
    assert.ok(parsed);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].label, 'Brief yes');
    assert.match(parsed[0].id, /^[0-9a-f-]{36}$/);
  });

  test('returns null for invalid payload', () => {
    assert.equal(parseReplyVariantsJson('not json'), null);
  });
});
