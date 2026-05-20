import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeLspConfig, matchServersForPath } from '../../src/lsp/merge-config.mjs';

describe('mergeLspConfig', () => {
  test('user disabled wins', () => {
    const merged = mergeLspConfig(
      { lsp: { typescript: { disabled: false, extensions: ['.ts'] } } },
      { lsp: { typescript: { disabled: true } } },
    );
    assert.equal(merged.lsp.typescript.disabled, true);
  });

  test('matchServersForPath skips disabled', () => {
    const merged = mergeLspConfig(
      {
        lsp: {
          fake: { disabled: false, extensions: ['.fake'] },
          off: { disabled: true, extensions: ['.fake'] },
        },
      },
      {},
    );
    const matches = matchServersForPath(merged, 'test/sample.fake');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, 'fake');
  });
});
