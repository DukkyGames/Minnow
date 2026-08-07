/**
 * Context usage ring surface resolution (hub / Code / desktop composers).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
} from '../helpers/legacy-desktop-state.ts';

function setupDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <button id="contextUsageRing"></button>
    <div id="contextUsageBreakdown"></div>
    <button id="chatAppContextUsageRing"></button>
    <div id="chatAppContextUsageBreakdown"></div>
    <button id="desktopContextRing"></button>
    <div id="desktopContextBreakdown"></div>
  `;
}

describe('context-usage-surface', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    setupDom(win);
    resetInstancesForTests();
    resetDesktopStateForTests();
  });

  afterEach(() => {
    resetDesktopStateForTests();
    resetInstancesForTests();
  });

  test('desktop idle hero resolves to desktop ring when concierge is mounted', async () => {
    const { getActiveContextUsageSurface } = await import(
      '../../src/ui/context-usage-surface.ts'
    );

    assert.equal(getActiveContextUsageSurface().ringId, 'desktopContextRing');
  });

  test('desktop chat active resolves to desktop ring', async () => {
    setDesktopStateForTests('chatActive');
    const { getActiveContextUsageSurface } = await import(
      '../../src/ui/context-usage-surface.ts'
    );

    assert.equal(getActiveContextUsageSurface().ringId, 'desktopContextRing');
  });

  test('Code foreground uses code ring even when desktop chat is active', async () => {
    const { launchInstance } = await import('../../src/os/instances.ts');
    setDesktopStateForTests('chatActive');
    launchInstance('code');

    const { getActiveContextUsageSurface } = await import(
      '../../src/ui/context-usage-surface.ts'
    );

    assert.equal(getActiveContextUsageSurface().ringId, 'contextUsageRing');
  });
});
