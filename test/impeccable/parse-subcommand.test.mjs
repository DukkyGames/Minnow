/**
 * Impeccable command-routing parse helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseImpeccableSubcommand } from '../../server/impeccable/command-routing.js';

describe('parseImpeccableSubcommand', () => {
  it('parses teach with empty target', () => {
    assert.deepEqual(parseImpeccableSubcommand('teach'), {
      command: 'teach',
      target: '',
    });
  });

  it('parses polish with target', () => {
    assert.deepEqual(parseImpeccableSubcommand('polish sidebar'), {
      command: 'polish',
      target: 'sidebar',
    });
  });

  it('returns null command for empty text', () => {
    assert.deepEqual(parseImpeccableSubcommand(''), {
      command: null,
      target: '',
    });
  });

  it('strips /impeccable prefix', () => {
    assert.deepEqual(parseImpeccableSubcommand('/impeccable teach'), {
      command: 'teach',
      target: '',
    });
  });

  it('returns first token for unknown command', () => {
    assert.deepEqual(parseImpeccableSubcommand('unknown-cmd arg'), {
      command: 'unknown-cmd',
      target: 'arg',
    });
  });
});
