import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Build after `npm run electron:build` so dist includes preview-instance-registry.js.
 * Pure data-structure module (no `electron` import) — same testing pattern as
 * preview-guest-actions.ts / test/electron/preview-automation.test.mjs.
 */
const {
  PreviewInstanceRegistry,
  DEFAULT_PREVIEW_INSTANCE_ID,
  MAX_LIVE_PREVIEW_INSTANCES,
} = await import('../../electron/dist/preview-instance-registry.js');

/** A stand-in for preview-host.ts's WindowPreviewState: just enough to prove per-instance isolation. */
function createState() {
  return { url: null, tabs: new Map(), activeTabId: null };
}

describe('PreviewInstanceRegistry', () => {
  test('resolveInstanceId defaults undefined/empty to workspace-preview', () => {
    assert.equal(PreviewInstanceRegistry.resolveInstanceId(undefined), DEFAULT_PREVIEW_INSTANCE_ID);
    assert.equal(PreviewInstanceRegistry.resolveInstanceId(''), DEFAULT_PREVIEW_INSTANCE_ID);
    assert.equal(PreviewInstanceRegistry.resolveInstanceId('  '), DEFAULT_PREVIEW_INSTANCE_ID);
    assert.equal(PreviewInstanceRegistry.resolveInstanceId(' design '), 'design');
  });

  test('two named instances hold different URLs simultaneously without cross-contamination', () => {
    const registry = new PreviewInstanceRegistry({ createState });

    const workspaceState = registry.ensure(1, 'workspace-preview');
    const designState = registry.ensure(1, 'design');

    // Distinct state objects — mutating one instance never touches the other.
    assert.notEqual(workspaceState, designState);

    workspaceState.url = 'https://workspace.example/index.html';
    designState.url = 'https://design.example/canvas';

    // Re-fetching each instance returns the SAME object with its own value intact.
    assert.equal(registry.get(1, 'workspace-preview').url, 'https://workspace.example/index.html');
    assert.equal(registry.get(1, 'design').url, 'https://design.example/canvas');
    assert.notEqual(registry.get(1, 'workspace-preview').url, registry.get(1, 'design').url);

    // Both instances are still present and independently addressable.
    assert.equal(registry.has(1, 'workspace-preview'), true);
    assert.equal(registry.has(1, 'design'), true);
  });

  test('omitting instanceId on ensure/get always targets the default workspace-preview instance', () => {
    const registry = new PreviewInstanceRegistry({ createState });

    const viaDefault = registry.ensure(1);
    const viaExplicitName = registry.ensure(1, DEFAULT_PREVIEW_INSTANCE_ID);
    assert.equal(viaDefault, viaExplicitName);

    viaDefault.url = 'https://default.example/';
    assert.equal(registry.get(1).url, 'https://default.example/');
    assert.equal(registry.get(1, 'workspace-preview').url, 'https://default.example/');
  });

  test('instances are isolated per window id even when instance ids collide', () => {
    const registry = new PreviewInstanceRegistry({ createState });

    const win1Design = registry.ensure(1, 'design');
    const win2Design = registry.ensure(2, 'design');
    assert.notEqual(win1Design, win2Design);

    win1Design.url = 'https://window-one.example/';
    win2Design.url = 'https://window-two.example/';

    assert.equal(registry.get(1, 'design').url, 'https://window-one.example/');
    assert.equal(registry.get(2, 'design').url, 'https://window-two.example/');
  });

  test('delete removes one instance and returns its state; sibling instance is untouched', () => {
    const registry = new PreviewInstanceRegistry({ createState });
    const workspace = registry.ensure(1, 'workspace-preview');
    const design = registry.ensure(1, 'design');
    workspace.url = 'kept';
    design.url = 'removed';

    const removed = registry.delete(1, 'design');
    assert.equal(removed.url, 'removed');
    assert.equal(registry.has(1, 'design'), false);
    assert.equal(registry.has(1, 'workspace-preview'), true);
    assert.equal(registry.get(1, 'workspace-preview').url, 'kept');
  });

  test('deleteWindow clears every instance for a window and returns [id, state] pairs', () => {
    const registry = new PreviewInstanceRegistry({ createState });
    registry.ensure(1, 'workspace-preview').url = 'a';
    registry.ensure(1, 'design').url = 'b';
    registry.ensure(2, 'workspace-preview').url = 'c';

    const removed = registry.deleteWindow(1);
    const byId = Object.fromEntries(removed.map(([id, state]) => [id, state.url]));
    assert.deepEqual(byId, { 'workspace-preview': 'a', design: 'b' });
    assert.equal(registry.has(1, 'workspace-preview'), false);
    assert.equal(registry.has(1, 'design'), false);
    // Window 2 is unaffected.
    assert.equal(registry.get(2, 'workspace-preview').url, 'c');
  });

  test('LRU-evicts the least-recently-touched hidden instance once over the cap', () => {
    const evicted = [];
    const registry = new PreviewInstanceRegistry({
      createState,
      maxLiveInstances: 2,
      onEvict: (windowId, instanceId, state) => {
        evicted.push({ windowId, instanceId, url: state.url });
      },
    });

    registry.ensure(1, 'a').url = 'a-url';
    registry.ensure(1, 'b').url = 'b-url';
    // Both hidden by default (registry does not assume visibility on creation).
    registry.setVisible(1, 'a', false);
    registry.setVisible(1, 'b', false);

    // 'a' is now the least-recently-touched of the two: creating a third instance
    // must evict it to stay within the cap of 2 live instances.
    registry.ensure(1, 'c').url = 'c-url';

    assert.equal(evicted.length, 1);
    assert.equal(evicted[0].instanceId, 'a');
    assert.equal(evicted[0].url, 'a-url');
    assert.equal(registry.has(1, 'a'), false);
    assert.equal(registry.has(1, 'b'), true);
    assert.equal(registry.has(1, 'c'), true);

    // Re-touching 'a' recreates it from scratch (fresh state, not resurrected).
    const recreated = registry.ensure(1, 'a');
    assert.equal(recreated.url, null);
  });

  test('visible instances are never evicted even when over the soft cap', () => {
    const evicted = [];
    const registry = new PreviewInstanceRegistry({
      createState,
      maxLiveInstances: 2,
      onEvict: (windowId, instanceId) => evicted.push(instanceId),
    });

    registry.ensure(1, 'a');
    registry.setVisible(1, 'a', true);
    registry.ensure(1, 'b');
    registry.setVisible(1, 'b', true);

    // Both live instances are visible — a third instance is allowed to grow past the cap
    // rather than silently destroying a surface the user is looking at.
    registry.ensure(1, 'c');

    assert.deepEqual(evicted, []);
    assert.equal(registry.has(1, 'a'), true);
    assert.equal(registry.has(1, 'b'), true);
    assert.equal(registry.has(1, 'c'), true);
  });

  test('MAX_LIVE_PREVIEW_INSTANCES default is used when no override is passed', () => {
    assert.equal(MAX_LIVE_PREVIEW_INSTANCES, 4);
    const evicted = [];
    const registry = new PreviewInstanceRegistry({
      createState,
      onEvict: (windowId, instanceId) => evicted.push(instanceId),
    });
    for (const id of ['a', 'b', 'c', 'd']) {
      registry.ensure(1, id);
      registry.setVisible(1, id, false);
    }
    assert.equal(evicted.length, 0);
    registry.ensure(1, 'e');
    assert.equal(evicted.length, 1);
    assert.equal(evicted[0], 'a');
  });

  test('listInstanceIds returns most-recently-touched first', () => {
    const registry = new PreviewInstanceRegistry({ createState });
    registry.ensure(1, 'a');
    registry.ensure(1, 'b');
    registry.ensure(1, 'c');
    registry.touch(1, 'a');
    assert.deepEqual(registry.listInstanceIds(1), ['a', 'c', 'b']);
  });
});
