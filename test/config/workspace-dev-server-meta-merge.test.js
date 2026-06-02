/**
 * mergeConfigMeta workspace block — dev-server settings and run state maps.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeConfigMeta } from '../../server/config/validators.js';

describe('mergeConfigMeta workspace dev-server maps', () => {
  test('merges devServerSettingsByPath from patch without dropping existing keys', () => {
    const merged = mergeConfigMeta(
      {
        workspace: {
          path: '/proj/a',
          devServerSettingsByPath: {
            '/proj/a': { port: 5173, network: 'local' },
            '/proj/b': { port: 3000, network: 'lan' },
          },
        },
      },
      {
        workspace: {
          devServerSettingsByPath: {
            '/proj/a': { port: 4321, network: 'local' },
          },
        },
      },
    );
    const byPath = /** @type {Record<string, { port: number }>} */ (
      merged.workspace.devServerSettingsByPath
    );
    assert.equal(byPath['/proj/a'].port, 4321);
    assert.equal(byPath['/proj/b'].port, 3000);
  });

  test('merges devServerByPath from patch without dropping existing keys', () => {
    const merged = mergeConfigMeta(
      {
        workspace: {
          devServerByPath: {
            '/proj/a': { status: 'stopped', port: 5173 },
          },
        },
      },
      {
        workspace: {
          devServerByPath: {
            '/proj/a': { status: 'running', port: 4321, runId: 'run-1' },
          },
        },
      },
    );
    const byPath = /** @type {Record<string, { status: string; port: number; runId?: string }>} */ (
      merged.workspace.devServerByPath
    );
    assert.equal(byPath['/proj/a'].status, 'running');
    assert.equal(byPath['/proj/a'].port, 4321);
    assert.equal(byPath['/proj/a'].runId, 'run-1');
  });
});
