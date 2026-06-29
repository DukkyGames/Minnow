/**
 * Impeccable command-routing parse helpers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseImpeccableSubcommand,
  resolveHarnessCommand,
} from '../../server/impeccable/command-routing.js';

describe('parseImpeccableSubcommand', () => {
  it('parses init with empty target', () => {
    assert.deepEqual(parseImpeccableSubcommand('init'), {
      command: 'init',
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
    assert.deepEqual(parseImpeccableSubcommand('/impeccable init'), {
      command: 'init',
      target: '',
    });
  });

  it('returns first token for unknown command', () => {
    assert.deepEqual(parseImpeccableSubcommand('unknown-cmd arg'), {
      command: 'unknown-cmd',
      target: 'arg',
    });
  });

  it('teach alias resolves to init via resolveHarnessCommand', () => {
    assert.equal(resolveHarnessCommand('teach'), 'init');
    assert.deepEqual(parseImpeccableSubcommand('teach'), {
      command: 'teach',
      target: '',
    });
  });
});
