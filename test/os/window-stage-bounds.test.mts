import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { initDockLauncher } from '../../src/os/dock-launcher.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { getWindowStageInsets } from '../../src/os/window-stage-bounds.ts';
import { getStageDimensions } from '../../src/os/stage-metrics.ts';
import { resetWindowManagerForTests, windowManager } from '../../src/os/window-manager.ts';
import { mountWindowFrame } from '../../src/os/window-frame.ts';

describe('window stage bounds', () => {
  let dockCleanup: (() => void) | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      localStorage: Storage;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.localStorage = win.localStorage;
    win.document.body.innerHTML = `
      <div id="osStage" class="mn-os-stage" style="width:1200px;height:800px;position:relative">
        <div id="osDesktopLayer" style="--os-dock-panel-inset:22px;--os-dock-block-height:100px;--os-safe-bottom:0px"></div>
        <div id="osWindowsLayer" class="mn-os-windows-layer"></div>
        <div id="osDockLayer"></div>
      </div>
    `;
    resetWindowManagerForTests();
    resetInstancesForTests();
    dockCleanup = initDockLauncher(document.getElementById('osDockLayer')!);
  });

  afterEach(() => {
    dockCleanup?.();
    dockCleanup = undefined;
    resetWindowManagerForTests();
    resetInstancesForTests();
  });

  test('clamps window height so the bottom stays above the dock', () => {
    const layer = document.getElementById('osWindowsLayer')!;
    const stage = document.getElementById('osStage')!;
    const stageHeight = getStageDimensions(stage).height;
    const insets = getWindowStageInsets();
    assert.ok(insets.bottom > 0, 'expected dock bottom inset');

    const frame = mountWindowFrame(layer, {
      windowId: 'test-win',
      title: 'Test',
      bounds: { x: 40, y: 40, width: 900, height: stageHeight },
    });

    const bounds = frame.getBounds();
    assert.ok(bounds.y + bounds.height <= stageHeight - insets.bottom + 1);
    assert.ok(bounds.height < stageHeight);
  });

  test('maximized windows use the full stage and hide the dock', () => {
    const id = windowManager.open('brain', { instanceId: 'inst-1' });
    windowManager.toggleMaximize(id);

    const frame = windowManager.getFrame(id);
    assert.ok(frame);
    const bounds = frame.getBounds();
    assert.equal(bounds.height, 800);
    assert.equal(getWindowStageInsets().bottom, 0);
  });
});
