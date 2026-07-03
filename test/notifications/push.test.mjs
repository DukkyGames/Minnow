import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('pushNotification mute gate', () => {
  let prefs;
  let push;
  let store;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis;
    g.window = win;
    g.localStorage = win.localStorage;
    prefs = await import('../../src/notifications/prefs.ts');
    store = await import('../../src/notifications/store.ts');
    push = await import('../../src/notifications/push.ts');
    prefs.resetNotificationPrefsForTests();
    store.resetNotificationStoreForTests();
    win.localStorage.clear();
  });

  afterEach(() => {
    prefs.resetNotificationPrefsForTests();
    store.resetNotificationStoreForTests();
  });

  test('returns null when notifications are muted', () => {
    prefs.saveNotificationPref('muted', true);
    const record = push.pushNotification({
      kind: 'chat_turn_complete',
      title: 'Chat',
      preview: 'Done',
      appId: 'code',
    });
    assert.equal(record, null);
    assert.equal(store.getUnreadNotificationCount(), 0);
    assert.equal(push.isPushEnabled(), false);
  });

  test('pushes when notifications are not muted', () => {
    const record = push.pushNotification({
      kind: 'chat_turn_complete',
      title: 'Chat',
      preview: 'Done',
      appId: 'code',
    });
    assert.notEqual(record, null);
    assert.equal(store.getUnreadNotificationCount(), 1);
    assert.equal(push.isPushEnabled(), true);
  });
});
