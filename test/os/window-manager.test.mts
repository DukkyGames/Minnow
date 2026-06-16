import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetWindowManagerForTests,
  windowManager,
  WINDOWS_STORAGE_KEY,
} from '../../src/os/window-manager.ts';

function setupWindowDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage" class="mn-os-stage" style="width:1200px;height:800px;position:relative">
      <div id="osWindowsLayer" class="mn-os-windows-layer"></div>
    </div>
    <main id="settingsView" class="settings-page"></main>
  `;
}

describe('windowManager', () => {
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
    win.localStorage.clear();
    setupWindowDom(win);
    resetWindowManagerForTests();
    resetInstancesForTests();
    resetAppHostForTests();
  });

  afterEach(() => {
    resetWindowManagerForTests();
    resetInstancesForTests();
    resetAppHostForTests();
  });

  test('open creates a window element in the windows layer', () => {
    const id = windowManager.open('settings', { instanceId: 'inst-1' });
    assert.ok(id);
    const layer = document.getElementById('osWindowsLayer');
    assert.ok(layer);
    assert.equal(layer?.querySelectorAll('.mn-os-window').length, 1);
    const windows = windowManager.getWindows();
    assert.equal(windows.length, 1);
    assert.equal(windows[0]?.appId, 'settings');
    assert.equal(windows[0]?.instanceId, 'inst-1');
  });

  test('close removes the window from the registry and DOM', () => {
    const id = windowManager.open('settings', { instanceId: 'inst-1' });
    windowManager.close(id);
    assert.equal(windowManager.getWindows().length, 0);
    assert.equal(document.querySelectorAll('.mn-os-window').length, 0);
  });

  test('focus raises z-order of the focused window', () => {
    const first = windowManager.open('settings', { instanceId: 'inst-a' });
    const second = windowManager.open('settings', { instanceId: 'inst-b' });
    windowManager.focus(first);
    const zBefore = windowManager.getWindows().find((w) => w.id === first)?.zIndex ?? 0;
    windowManager.focus(second);
    const zAfterFirst = windowManager.getWindows().find((w) => w.id === first)?.zIndex ?? 0;
    const zAfterSecond = windowManager.getWindows().find((w) => w.id === second)?.zIndex ?? 0;
    assert.ok(zAfterSecond > zAfterFirst);
    assert.ok(zAfterFirst >= zBefore);
    assert.equal(windowManager.getFocusedWindowId(), second);
  });

  test('minimize toggles minimized state', () => {
    const id = windowManager.open('settings', { instanceId: 'inst-1' });
    windowManager.minimize(id, true);
    assert.equal(windowManager.getWindows()[0]?.minimized, true);
    windowManager.minimize(id, false);
    assert.equal(windowManager.getWindows()[0]?.minimized, false);
  });

  test('re-open with same instanceId foregrounds existing window', () => {
    const first = windowManager.open('settings', { instanceId: 'inst-1' });
    const second = windowManager.open('settings', { instanceId: 'inst-1' });
    assert.equal(first, second);
    assert.equal(windowManager.getWindows().length, 1);
  });

  test('re-open with activate:false does not steal focus from another window', () => {
    const settings = windowManager.open('settings', { instanceId: 'inst-settings' });
    const models = windowManager.open('models', { instanceId: 'inst-models' });
    windowManager.focus(settings);
    assert.equal(windowManager.getFocusedWindowId(), settings);

    windowManager.open('models', { instanceId: 'inst-models', activate: false });
    assert.equal(windowManager.getFocusedWindowId(), settings);
  });

  test('persists bounds to localStorage on close', () => {
    const id = windowManager.open('settings', { instanceId: 'inst-1' });
    const frame = windowManager.getFrame(id);
    assert.ok(frame);
    frame.setBounds({ x: 120, y: 90, width: 640, height: 480 });
    windowManager.close(id);
    const raw = localStorage.getItem(WINDOWS_STORAGE_KEY);
    assert.ok(raw);
    const parsed = JSON.parse(raw) as { settings?: { bounds: { x: number } } };
    assert.equal(parsed.settings?.bounds.x, 120);
  });
});

describe('window snap helpers', () => {
  test('detectSnapPreview returns left half for left edge', async () => {
    const { detectSnapPreview } = await import('../../src/os/window-snap.ts');
    const rect = { left: 0, top: 0, width: 1000, height: 800 } as DOMRect;
    const preview = detectSnapPreview(4, 400, rect);
    assert.ok(preview);
    assert.equal(preview.mode, 'left');
    assert.equal(preview.rect.width, 500);
  });
});
