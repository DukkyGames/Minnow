/**
 * Workspace-keyed config maps: the client and server spell keys differently
 * (`C:/Users/me/App` vs `c:\users\me\app`), so lookups must match loosely or
 * per-workspace file-panel / terminal state is written and never read back.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findWorkspaceMapKey,
  looseWorkspaceMapKey,
  readWorkspaceMapRow,
} from '../../src/lib/workspace-scoped-map.ts';

describe('workspace-scoped config maps', () => {
  test('matches the server key spelling for a client-written path', () => {
    const stored = { 'c:\\users\\dukky\\documents\\github\\vinea': { treeRoot: 'src' } };
    const row = readWorkspaceMapRow(stored, 'C:/Users/dukky/Documents/GitHub/Vinea');
    assert.deepEqual(row, { treeRoot: 'src' });
  });

  test('reports the key as stored so writes and deletes hit the same row', () => {
    const stored = { 'c:\\users\\dukky\\code\\app': 'pwsh' };
    assert.equal(
      findWorkspaceMapKey(stored, 'C:/Users/dukky/Code/app'),
      'c:\\users\\dukky\\code\\app',
    );
  });

  test('prefers an exact key when one is present', () => {
    const stored = { 'C:/Users/me/app': 'exact', 'c:\\users\\me\\app': 'loose' };
    assert.equal(findWorkspaceMapKey(stored, 'C:/Users/me/app'), 'C:/Users/me/app');
  });

  test('POSIX paths stay case-folded but otherwise intact', () => {
    const stored = { '/home/me/Code/App': { treeRoot: '.' } };
    assert.deepEqual(readWorkspaceMapRow(stored, '/home/me/Code/App'), { treeRoot: '.' });
    assert.equal(looseWorkspaceMapKey('/home/me/Code/App/'), '/home/me/code/app');
  });

  test('an unknown folder resolves to nothing rather than a neighbouring row', () => {
    const stored = { 'c:\\users\\me\\app': 1, 'c:\\users\\me\\app-two': 2 };
    assert.equal(readWorkspaceMapRow(stored, 'C:/Users/me/other'), undefined);
    assert.equal(readWorkspaceMapRow(stored, 'C:/Users/me/app-two'), 2);
  });

  test('an empty workspace path never matches a row', () => {
    assert.equal(findWorkspaceMapKey({ '': 1, 'c:\\x': 2 }, ''), undefined);
    assert.equal(readWorkspaceMapRow(undefined, 'C:/x'), undefined);
  });
});
