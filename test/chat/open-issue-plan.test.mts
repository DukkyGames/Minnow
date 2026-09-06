/**
 * Open plan from Issues must reuse the window already on that folder.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { openIssuePlanInEditor } from '../../src/chat/issues/pipeline.ts';
import { resetWorkspaceStateForTests, setWorkspaceFromServer } from '../../src/state/workspace.ts';

const CURRENT = '/home/user/minnow';
const OTHER = '/home/user/other';

describe('openIssuePlanInEditor window reuse', () => {
  let domWindow: Window;
  let focused: string[];

  beforeEach(() => {
    domWindow = new Window();
    installHappyDomGlobals(domWindow);
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({ path: CURRENT, label: 'minnow', isDefault: false });
    focused = [];
    window.minnow = {
      window: {
        openWorkspace: async (workspacePath: string) => {
          focused.push(workspacePath);
          return { ok: true, focused: true };
        },
        listWorkspaceWindows: async () => [
          { windowId: 1, workspacePath: CURRENT, visible: true },
          { windowId: 2, workspacePath: OTHER, visible: true },
        ],
      },
    } as typeof window.minnow;
  });

  afterEach(() => {
    delete window.minnow;
    resetWorkspaceStateForTests();
    domWindow.close();
  });

  test('focuses the window already on the issue folder instead of retargeting', async () => {
    await openIssuePlanInEditor('documentation/plans/issues/MIN-1.md', OTHER);
    assert.deepEqual(focused, [OTHER]);
  });
});
