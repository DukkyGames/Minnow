/**
 * isCurrentWindowWorkspace: bound view path wins; gate windows never match.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import {
  isCurrentWindowWorkspace,
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';

const LIVE = '/home/user/minnow';
const OTHER = '/home/user/other';

describe('isCurrentWindowWorkspace', () => {
  let domWindow: Window;

  beforeEach(() => {
    domWindow = new Window();
    installHappyDomGlobals(domWindow);
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({ path: LIVE, label: 'minnow', isDefault: false });
  });

  afterEach(() => {
    delete window.minnow;
    resetWorkspaceStateForTests();
    domWindow.close();
  });

  test('matches the live path when there is no Electron view context', () => {
    assert.equal(isCurrentWindowWorkspace(LIVE), true);
    assert.equal(isCurrentWindowWorkspace(`${LIVE}/`), true);
    assert.equal(isCurrentWindowWorkspace(OTHER), false);
  });

  test('prefers the bound view folder over a stale live path', () => {
    window.minnow = {
      viewContext: { workspacePath: OTHER, viewId: 'view-1', hosted: false },
    } as typeof window.minnow;

    assert.equal(isCurrentWindowWorkspace(OTHER), true);
    assert.equal(isCurrentWindowWorkspace(LIVE), false);
  });

  test('unbound gate window is never already on a folder', () => {
    window.minnow = {
      viewContext: { workspacePath: '', viewId: 'view-1', hosted: false },
    } as typeof window.minnow;

    assert.equal(isCurrentWindowWorkspace(LIVE), false);
    assert.equal(isCurrentWindowWorkspace(OTHER), false);
  });
});
