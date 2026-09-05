import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildWorkspacesMenuTemplate,
  workspaceMenuLabel,
  type TrayWorkspaceEntry,
} from '../../electron/tray-workspaces.ts';

function noopActions() {
  const focused: number[] = [];
  const closed: number[] = [];
  let closedBackgrounded = 0;
  return {
    focused,
    closed,
    countClosedBackgrounded: () => closedBackgrounded,
    actions: {
      focus: (id: number) => focused.push(id),
      close: (id: number) => closed.push(id),
      closeBackgrounded: () => {
        closedBackgrounded += 1;
      },
    },
  };
}

const entries: TrayWorkspaceEntry[] = [
  { windowId: 1, workspacePath: '/repo/minnow', visible: true },
  { windowId: 2, workspacePath: 'C:\\src\\other', visible: false },
];

describe('workspaceMenuLabel', () => {
  test('uses the last path segment, on either separator', () => {
    assert.equal(workspaceMenuLabel('/repo/minnow'), 'minnow');
    assert.equal(workspaceMenuLabel('C:\\src\\other\\'), 'other');
  });

  test('names a drive root and a window still at the gate', () => {
    assert.equal(workspaceMenuLabel('C:\\'), 'C:\\');
    assert.equal(workspaceMenuLabel('   '), 'No folder');
  });
});

describe('buildWorkspacesMenuTemplate', () => {
  test('lists one entry per window and marks backgrounded ones', () => {
    const { actions } = noopActions();
    const menu = buildWorkspacesMenuTemplate(entries, actions);
    assert.equal(menu.label, 'Workspaces');
    const labels = menu.submenu?.map((item) => item.label);
    assert.deepEqual(labels?.slice(0, 2), ['minnow', 'other (background)']);
  });

  test('offers focus and close per window, wired to that window id', () => {
    const spy = noopActions();
    const menu = buildWorkspacesMenuTemplate(entries, spy.actions);

    const visible = menu.submenu?.[0]?.submenu ?? [];
    assert.equal(visible[0]?.label, '/repo/minnow');
    assert.equal(visible[0]?.enabled, false);
    assert.equal(visible[2]?.label, 'Focus window');
    assert.equal(visible[3]?.label, 'Close workspace');
    visible[2]?.click?.();
    visible[3]?.click?.();
    assert.deepEqual(spy.focused, [1]);
    assert.deepEqual(spy.closed, [1]);

    // A hidden window is shown, not merely focused.
    const hidden = menu.submenu?.[1]?.submenu ?? [];
    assert.equal(hidden[2]?.label, 'Show window');
  });

  test('adds a bulk action only while something is backgrounded', () => {
    const spy = noopActions();
    const menu = buildWorkspacesMenuTemplate(entries, spy.actions);
    const bulk = menu.submenu?.at(-1);
    assert.equal(bulk?.label, 'Close 1 background workspace');
    bulk?.click?.();
    assert.equal(spy.countClosedBackgrounded(), 1);

    const allVisible = buildWorkspacesMenuTemplate(
      [{ windowId: 1, workspacePath: '/repo/minnow', visible: true }],
      spy.actions,
    );
    assert.equal(allVisible.submenu?.length, 1);
    assert.equal(allVisible.submenu?.[0]?.label, 'minnow');
  });

  test('says so when nothing is open rather than rendering an empty submenu', () => {
    const { actions } = noopActions();
    const menu = buildWorkspacesMenuTemplate([], actions);
    assert.deepEqual(menu.submenu, [{ label: 'No open workspaces', enabled: false }]);
  });
});
