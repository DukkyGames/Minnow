import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('notification store', () => {
  let store;

  beforeEach(async () => {
    store = await import('../../src/notifications/store.ts');
    store.resetNotificationStoreForTests();
  });

  afterEach(() => {
    store.resetNotificationStoreForTests();
  });

  test('push via append increases unread count', () => {
    store.appendNotification({
      id: 'n1',
      kind: 'scheduler',
      title: 'Scheduler',
      preview: 'Job done',
      appId: 'scheduler',
      createdAt: 1000,
      read: false,
    });
    assert.equal(store.getUnreadNotificationCount(), 1);
    assert.equal(store.getNotifications().length, 1);
  });

  test('mark all read clears unread badge count', () => {
    store.appendNotification({
      id: 'n1',
      kind: 'research',
      title: 'Research',
      preview: 'Brief ready',
      appId: 'research',
      createdAt: 1000,
      read: false,
    });
    store.markAllNotificationsRead();
    assert.equal(store.getUnreadNotificationCount(), 0);
  });

  test('caps inbox at 100 items', () => {
    for (let i = 0; i < 105; i += 1) {
      store.appendNotification({
        id: `n-${i}`,
        kind: 'scheduler',
        title: 'T',
        preview: 'p',
        appId: 'scheduler',
        createdAt: i,
        read: false,
      });
    }
    assert.equal(store.getNotifications().length, 100);
    assert.equal(store.getNotifications()[0]?.id, 'n-104');
  });

  test('subscribe receives updates', () => {
    let count = 0;
    const unsub = store.subscribeNotifications(() => {
      count += 1;
    });
    store.appendNotification({
      id: 'n1',
      kind: 'scheduler',
      title: 'Scheduler',
      preview: 'x',
      appId: 'scheduler',
      createdAt: 1,
      read: false,
    });
    unsub();
    assert.equal(count, 1);
  });

  test('dedupe keys are session-scoped', () => {
    assert.equal(store.hasDedupeKey('a'), false);
    store.rememberDedupeKey('a');
    assert.equal(store.hasDedupeKey('a'), true);
  });
});
