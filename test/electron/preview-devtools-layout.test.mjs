import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Build after `npm run electron:build` so dist includes preview-devtools-layout.js.
 * Pure math module (no `electron` import) — same testing pattern as
 * preview-instance-registry.ts (MIN-177 docked DevTools split).
 */
const {
  splitPreviewBounds,
  DEVTOOLS_DOCK_RATIO,
  DEVTOOLS_MIN_HEIGHT,
  GUEST_MIN_HEIGHT,
  DEVTOOLS_SUPPRESS_HEIGHT,
} = await import('../../electron/dist/preview-devtools-layout.js');

describe('splitPreviewBounds', () => {
  test('closed DevTools leaves the guest with the full rect', () => {
    const rect = { x: 10, y: 20, width: 800, height: 600 };
    const split = splitPreviewBounds(rect, false);
    assert.deepEqual(split.guest, rect);
    assert.equal(split.devtools, null);
  });

  test('open DevTools docks the bottom slice at the ratio and tiles exactly', () => {
    const rect = { x: 0, y: 100, width: 1000, height: 800 };
    const split = splitPreviewBounds(rect, true);
    assert.ok(split.devtools, 'devtools slice expected');
    assert.equal(split.devtools.height, Math.round(800 * DEVTOOLS_DOCK_RATIO));
    // Guest on top, DevTools directly below, no gap or overlap, same width.
    assert.equal(split.guest.y, rect.y);
    assert.equal(split.devtools.y, split.guest.y + split.guest.height);
    assert.equal(split.guest.height + split.devtools.height, rect.height);
    assert.equal(split.guest.width, rect.width);
    assert.equal(split.devtools.width, rect.width);
  });

  test('short panes clamp so DevTools never squeezes the page below its minimum', () => {
    // min DevTools height (160) would leave only 100px of page at h=260 — clamp wins.
    const rect = { x: 0, y: 0, width: 640, height: 260 };
    const split = splitPreviewBounds(rect, true);
    assert.ok(split.devtools);
    assert.equal(split.guest.height, GUEST_MIN_HEIGHT);
    assert.equal(split.devtools.height, rect.height - GUEST_MIN_HEIGHT);
  });

  test('DevTools grows to its minimum height before the ratio kicks in', () => {
    // 45% of 340 = 153 < DEVTOOLS_MIN_HEIGHT, so the min wins (still room above guest min).
    const rect = { x: 0, y: 0, width: 640, height: 340 };
    const split = splitPreviewBounds(rect, true);
    assert.ok(split.devtools);
    assert.equal(split.devtools.height, DEVTOOLS_MIN_HEIGHT);
  });

  test('panes too short to dock usefully suppress the slice but keep the guest whole', () => {
    const rect = { x: 0, y: 0, width: 640, height: GUEST_MIN_HEIGHT + DEVTOOLS_SUPPRESS_HEIGHT - 1 };
    const split = splitPreviewBounds(rect, true);
    assert.deepEqual(split.guest, rect);
    assert.equal(split.devtools, null);
  });
});
