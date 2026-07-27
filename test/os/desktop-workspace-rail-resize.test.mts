import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  applyDesktopWorkspaceDrawerWidth,
  clampWorkspaceDrawerWidth,
  DEFAULT_WORKSPACE_DRAWER_W,
  resetDesktopWorkspaceRailResizeForTests,
  WORKSPACE_DRAWER_MIN_W,
} from '../../src/os/desktop-workspace-rail-resize.ts';

describe('desktop workspace rail resize', () => {
  beforeEach(() => {
    const win = new Window({ innerWidth: 1400, innerHeight: 900 });
    const g = globalThis as typeof globalThis & { window: Window; document: Document };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
  });

  afterEach(() => {
    resetDesktopWorkspaceRailResizeForTests();
  });

  test('clampWorkspaceDrawerWidth enforces min and viewport cap', () => {
    const layer = { getBoundingClientRect: () => ({ width: 1200 }) } as HTMLElement;
    assert.equal(clampWorkspaceDrawerWidth(200, layer), WORKSPACE_DRAWER_MIN_W);
    assert.equal(clampWorkspaceDrawerWidth(900, layer), 900);
    assert.equal(clampWorkspaceDrawerWidth(1200, layer), 900);
  });

  test('applyDesktopWorkspaceDrawerWidth sets CSS variable on stage', () => {
    document.body.innerHTML = '<div id="osStage"><div id="osDesktopLayer"></div></div>';
    const stage = document.getElementById('osStage')!;
    const layer = document.getElementById('osDesktopLayer')!;
    layer.getBoundingClientRect = () =>
      ({ width: 1400, height: 900, top: 0, left: 0, right: 1400, bottom: 900 }) as DOMRect;
    applyDesktopWorkspaceDrawerWidth(DEFAULT_WORKSPACE_DRAWER_W);
    assert.equal(
      stage.style.getPropertyValue('--desktop-workspace-drawer-w'),
      `${DEFAULT_WORKSPACE_DRAWER_W}px`,
    );
  });
});
