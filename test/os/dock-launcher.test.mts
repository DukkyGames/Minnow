import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { initDockLauncher } from '../../src/os/dock-launcher.ts';
import { resetDesktopStateForTests } from '../../src/os/desktop-state.ts';
import {
  launchInstance,
  resetInstancesForTests,
} from '../../src/os/instances.ts';
import { resetWindowManagerForTests } from '../../src/os/window-manager.ts';

function dockTile(appId: string): HTMLButtonElement | null {
  return document.querySelector(
    `.mn-os-tile-dock[data-app-id="${appId}"]`,
  ) as HTMLButtonElement | null;
}

function dockOpenDot(appId: string): HTMLElement | null {
  return dockTile(appId)?.querySelector('.mn-os-tile-open-dot') ?? null;
}

describe('dock launcher open highlights', () => {
  let cleanup: (() => void) | undefined;

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
    win.document.body.innerHTML = '<div id="osDockLayer"></div>';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetWindowManagerForTests();
    cleanup = initDockLauncher(document.getElementById('osDockLayer')!);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test('marks window apps open when an instance exists', () => {
    const settings = dockTile('settings');
    assert.ok(settings);
    assert.equal(settings.classList.contains('is-open'), false);

    launchInstance('settings');

    assert.equal(settings.classList.contains('is-open'), true);
    assert.equal(settings.classList.contains('is-active'), true);
    assert.equal(settings.getAttribute('aria-pressed'), 'true');
    assert.equal(dockOpenDot('settings')?.hidden, false);
  });

  test('keeps open highlight when another app is foreground', () => {
    launchInstance('settings');
    launchInstance('models');

    const settings = dockTile('settings')!;
    const models = dockTile('models')!;

    assert.equal(settings.classList.contains('is-open'), true);
    assert.equal(settings.classList.contains('is-active'), false);
    assert.equal(models.classList.contains('is-open'), true);
    assert.equal(models.classList.contains('is-active'), true);
    assert.equal(dockOpenDot('settings')?.hidden, false);
    assert.equal(dockOpenDot('models')?.hidden, false);
  });
});
