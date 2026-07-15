/**
 * Research activity overlay open/close and row rendering.
 */
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';

import { ActivityLogBuffer, resetActivityLogIdsForTests } from '../../src/research/activity-log.ts';
import {
  closeResearchActivityOverlay,
  destroyResearchActivityOverlay,
  isResearchActivityOverlayOpen,
  openResearchActivityOverlay,
} from '../../src/research/activity-overlay.ts';

/** @type {import('happy-dom').Window | undefined} */
let win: import('happy-dom').Window | undefined;

beforeEach(async () => {
  resetActivityLogIdsForTests();
  const { Window } = await import('happy-dom');
  win = new Window();
  globalThis.window = win;
  globalThis.document = win.document;
});

afterEach(() => {
  destroyResearchActivityOverlay();
  win?.close();
  win = undefined;
  delete (globalThis as { window?: Window }).window;
  delete (globalThis as { document?: Document }).document;
});

describe('research-activity-overlay', () => {
  test('open renders rows and Escape closes', () => {
    const buffer = new ActivityLogBuffer();
    buffer.appendFromResearchProgress({ phase: 'planning', planSummary: 'Plan outline' });
    buffer.appendFromResearchProgress({
      phase: 'searching',
      round: 1,
      queryList: ['one'],
      queryCount: 1,
      totalSources: 0,
    });

    openResearchActivityOverlay(buffer, { getRunning: () => true, getElapsedMs: () => 12_000 });
    assert.equal(isResearchActivityOverlayOpen(), true);

    const rows = document.querySelectorAll('.research-activity-row');
    assert.equal(rows.length, 2);
    assert.match(rows[0]!.textContent ?? '', /Planning/);
    assert.match(rows[1]!.textContent ?? '', /Searching/);

    document.dispatchEvent(new win!.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(isResearchActivityOverlayOpen(), false);
  });

  test('empty state copy is shown before first entry', () => {
    const buffer = new ActivityLogBuffer();
    openResearchActivityOverlay(buffer);
    const empty = document.querySelector('.research-activity-overlay__empty');
    assert.ok(empty);
    assert.match(empty!.textContent ?? '', /Activity will appear here/);
    closeResearchActivityOverlay();
  });
});
