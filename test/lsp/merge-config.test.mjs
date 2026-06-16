import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  mergeLspConfig,
  matchServersForPath,
  serverSupportsWorkspaceSymbols,
} from '../../src/lsp/merge-config.mjs';

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

describe('serverSupportsWorkspaceSymbols', () => {
  test('html/css/yaml/dockerfile default off', () => {
    assert.equal(serverSupportsWorkspaceSymbols('html', {}), false);
    assert.equal(serverSupportsWorkspaceSymbols('css', {}), false);
    assert.equal(serverSupportsWorkspaceSymbols('yaml-ls', {}), false);
    assert.equal(serverSupportsWorkspaceSymbols('dockerfile', {}), false);
  });

  test('typescript/pyright default on', () => {
    assert.equal(serverSupportsWorkspaceSymbols('typescript', {}), true);
    assert.equal(serverSupportsWorkspaceSymbols('pyright', {}), true);
  });

  test('config flag overrides defaults', () => {
    assert.equal(
      serverSupportsWorkspaceSymbols('html', { workspaceSymbols: true }),
      true,
    );
    assert.equal(
      serverSupportsWorkspaceSymbols('typescript', { workspaceSymbols: false }),
      false,
    );
  });

  test('initialize capability wins when present', () => {
    assert.equal(
      serverSupportsWorkspaceSymbols('html', {}, { workspaceSymbolProvider: true }),
      true,
    );
    assert.equal(
      serverSupportsWorkspaceSymbols('typescript', {}, { workspaceSymbolProvider: false }),
      false,
    );
  });
});
