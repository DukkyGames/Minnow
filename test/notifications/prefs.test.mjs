import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('notification prefs', () => {
  let prefs;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis;
    g.window = win;
    g.localStorage = win.localStorage;
    prefs = await import('../../src/notifications/prefs.ts');
    prefs.resetNotificationPrefsForTests();
    win.localStorage.clear();
  });

  afterEach(() => {
    prefs.resetNotificationPrefsForTests();
  });

  test('loads defaults when storage empty', () => {
    const loaded = prefs.loadNotificationPrefs();
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.soundId, 'chime');
    assert.equal(loaded.chatEnabled, true);
  });

  test('persists and reloads toggles', () => {
    prefs.saveNotificationPref('enabled', false);
    prefs.saveNotificationPref('soundId', 'ping');
    const loaded = prefs.loadNotificationPrefs();
    assert.equal(loaded.enabled, false);
    assert.equal(loaded.soundId, 'ping');
  });

  test('kind group gating respects master enable', () => {
    prefs.saveNotificationPrefs({
      enabled: false,
      soundEnabled: true,
      soundId: 'chime',
      chatEnabled: true,
      tasksEnabled: true,
      backgroundEnabled: true,
    });
    assert.equal(prefs.isNotificationKindEnabled('chat_turn_complete'), false);
  });
});
