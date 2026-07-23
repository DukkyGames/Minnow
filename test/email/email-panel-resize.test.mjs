/**
 * Email panel width clamp + persistence helpers.
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import {
  clampEmailRailWidth,
  clampEmailReaderDockWidth,
  clampEmailAssistantDockWidth,
  DEFAULT_EMAIL_RAIL_W,
  DEFAULT_EMAIL_READER_DOCK_W,
  DEFAULT_EMAIL_ASSISTANT_DOCK_W,
  EMAIL_RAIL_MAX_W,
  EMAIL_RAIL_MIN_W,
  EMAIL_READER_DOCK_MAX_W,
  EMAIL_READER_DOCK_MIN_W,
  EMAIL_ASSISTANT_DOCK_MAX_W,
  EMAIL_ASSISTANT_DOCK_MIN_W,
  resetEmailPanelWidthsForTests,
  invalidateEmailPanelWidthCacheForTests,
  resolvedEmailRailWidth,
  resolvedEmailReaderDockWidth,
  resolvedEmailAssistantDockWidth,
} from '../../src/ui/email/email-panel-resize.ts';

describe('email panel resize', () => {
  /** Minimal localStorage stub for Node test runs. */
  let storage = {};

  beforeEach(() => {
    storage = {};
    globalThis.localStorage = {
      getItem: (key) => (key in storage ? storage[key] : null),
      setItem: (key, value) => {
        storage[key] = String(value);
      },
      removeItem: (key) => {
        delete storage[key];
      },
    };
    resetEmailPanelWidthsForTests();
  });

  afterEach(() => {
    resetEmailPanelWidthsForTests();
    delete globalThis.localStorage;
  });

  test('clampEmailRailWidth enforces bounds and defaults', () => {
    assert.equal(clampEmailRailWidth(NaN), DEFAULT_EMAIL_RAIL_W);
    assert.equal(clampEmailRailWidth(100), EMAIL_RAIL_MIN_W);
    assert.equal(clampEmailRailWidth(999), EMAIL_RAIL_MAX_W);
    assert.equal(clampEmailRailWidth(244), 244);
  });

  test('clampEmailReaderDockWidth enforces bounds and defaults', () => {
    assert.equal(clampEmailReaderDockWidth(NaN), DEFAULT_EMAIL_READER_DOCK_W);
    assert.equal(clampEmailReaderDockWidth(200), EMAIL_READER_DOCK_MIN_W);
    assert.equal(clampEmailReaderDockWidth(2000), EMAIL_READER_DOCK_MAX_W);
    assert.equal(clampEmailReaderDockWidth(600), 600);
  });

  test('clampEmailAssistantDockWidth enforces bounds and defaults', () => {
    assert.equal(clampEmailAssistantDockWidth(NaN), DEFAULT_EMAIL_ASSISTANT_DOCK_W);
    assert.equal(clampEmailAssistantDockWidth(200), EMAIL_ASSISTANT_DOCK_MIN_W);
    assert.equal(clampEmailAssistantDockWidth(2000), EMAIL_ASSISTANT_DOCK_MAX_W);
    assert.equal(clampEmailAssistantDockWidth(440), 440);
  });

  test('resolved widths fall back to defaults when nothing is stored', () => {
    assert.equal(resolvedEmailRailWidth(), DEFAULT_EMAIL_RAIL_W);
    assert.equal(resolvedEmailReaderDockWidth(), DEFAULT_EMAIL_READER_DOCK_W);
    assert.equal(resolvedEmailAssistantDockWidth(), DEFAULT_EMAIL_ASSISTANT_DOCK_W);
  });

  test('resolved widths read persisted localStorage values', () => {
    localStorage.setItem(
      'minnow.email.panelWidths',
      JSON.stringify({ rail: 300, readerDock: 720, assistantDock: 520 }),
    );
    invalidateEmailPanelWidthCacheForTests();
    assert.equal(resolvedEmailRailWidth(), 300);
    assert.equal(resolvedEmailReaderDockWidth(), 720);
    assert.equal(resolvedEmailAssistantDockWidth(), 520);
  });
});
