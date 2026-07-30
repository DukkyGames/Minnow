/**
 * /compress slash command parsing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCompressSlashInput } from '../../src/chat/context/parse-compress-command.ts';

describe('parseCompressSlashInput', () => {
  test('accepts /compress', () => {
    assert.deepEqual(parseCompressSlashInput('/compress'), { kind: 'compress' });
  });

  test('accepts /summarize alias', () => {
    assert.deepEqual(parseCompressSlashInput('/summarize'), { kind: 'summarize-alias' });
  });

  test('rejects partial commands', () => {
    assert.equal(parseCompressSlashInput('/compress now'), null);
    assert.equal(parseCompressSlashInput('compress'), null);
  });
});
