/**
 * launch_minnow_app browser tool executor.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { resetOsRouterForTests } from '../../src/os/router.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import { executeBrowserTool } from '../../src/tools/browser-executor.ts';
import { toolLaunchMinnowApp } from '../../src/tools/os-launch-tool.ts';
import type { AppId } from '../../src/os/types.ts';

describe('launch_minnow_app', () => {
  test('executor returns ok JSON and calls launchApp with app_id and seed', () => {
    const calls: Array<{ appId: AppId; options?: { seed?: string } }> = [];
    const launchApp = (appId: AppId, options?: { seed?: string }) => {
      calls.push({ appId, options });
    };

    const raw = toolLaunchMinnowApp(
      { app_id: 'code', seed: 'fix auth bug in src/api' },
      launchApp,
    );
    const parsed = JSON.parse(raw) as { ok: boolean; appId: string; hash: string };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.appId, 'code');
    assert.equal(parsed.hash, '#/app/code');
    assert.deepEqual(calls, [
      { appId: 'code', options: { seed: 'fix auth bug in src/api' } },
    ]);
  });

  test('supports chat app_id with seed', () => {
    const calls: Array<{ appId: AppId; options?: { seed?: string } }> = [];
    const launchApp = (appId: AppId, options?: { seed?: string }) => {
      calls.push({ appId, options });
    };

    const raw = toolLaunchMinnowApp({ app_id: 'chat', seed: 'explain recursion' }, launchApp);
    const parsed = JSON.parse(raw) as { ok: boolean; appId: string; hash: string };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.appId, 'chat');
    assert.equal(parsed.hash, '#/app/chat');
    assert.deepEqual(calls, [{ appId: 'chat', options: { seed: 'explain recursion' } }]);
  });

  test('rejects invalid app_id', () => {
    const result = toolLaunchMinnowApp({ app_id: 'unknown' }, () => {});
    assert.match(result, /^Error: invalid app_id/);
  });

  test('requires app_id', () => {
    const result = toolLaunchMinnowApp({}, () => {});
    assert.equal(result, 'Error: "app_id" is required');
  });
});

describe('executeBrowserTool launch_minnow_app', () => {
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
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
  });

  afterEach(() => {
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('routes launch_minnow_app and updates the OS hash', async () => {
    const result = await executeBrowserTool('launch_minnow_app', { app_id: 'bench' });
    const parsed = JSON.parse(result) as { ok: boolean; appId: string; hash: string };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.appId, 'bench');
    assert.equal(parsed.hash, '#/app/bench');
    assert.equal(window.location.hash, '#/app/bench');
  });
});
