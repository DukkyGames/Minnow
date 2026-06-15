/**
 * Push a notification into the inbox, respecting prefs, dedupe, sound, and bell ring.
 */

import { noteAgentMessage } from '../os/instances';
import { isNotificationKindEnabled, loadNotificationPrefs } from './prefs';
import { playNotificationSound, shouldPlayNotificationSound } from './sound';
import {
  appendNotification,
  hasDedupeKey,
  rememberDedupeKey,
} from './store';
import type { PushNotificationInput, NotificationRecord } from './types';

type NewNotificationListener = (record: NotificationRecord) => void;

const newListeners = new Set<NewNotificationListener>();

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Subscribe to newly pushed unread notifications (menubar bell ring). */
export function onNewNotification(listener: NewNotificationListener): () => void {
  newListeners.add(listener);
  return () => {
    newListeners.delete(listener);
  };
}

function notifyNew(record: NotificationRecord): void {
  for (const fn of newListeners) {
    try {
      fn(record);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/**
 * Insert a notification row when prefs allow it.
 * Also updates legacy per-app unread badges via {@link noteAgentMessage}.
 */
export function pushNotification(input: PushNotificationInput): NotificationRecord | null {
  if (!isNotificationKindEnabled(input.kind)) return null;

  if (input.dedupeKey) {
    if (hasDedupeKey(input.dedupeKey)) return null;
    rememberDedupeKey(input.dedupeKey);
  }

  const record: NotificationRecord = {
    id: input.id ?? newId(),
    kind: input.kind,
    title: input.title,
    preview: input.preview,
    chatId: input.chatId,
    appId: input.appId,
    createdAt: input.createdAt ?? Date.now(),
    read: false,
    dedupeKey: input.dedupeKey,
  };

  appendNotification(record);

  // Legacy dock / instance badge until fully migrated.
  const legacyMsg = input.preview.trim() || input.title;
  noteAgentMessage(input.appId, legacyMsg);

  notifyNew(record);

  if (shouldPlayNotificationSound()) {
    playNotificationSound();
  }

  return record;
}

/** Convenience wrapper matching legacy `noteAgentMessage` signature. */
export function pushLegacyAgentNotification(
  appId: PushNotificationInput['appId'],
  msg: string,
  kind: PushNotificationInput['kind'] = 'scheduler',
  title?: string,
): NotificationRecord | null {
  return pushNotification({
    kind,
    title: title ?? appId,
    preview: msg,
    appId,
  });
}

/** Expose prefs gate for tests. */
export function isPushEnabled(): boolean {
  return loadNotificationPrefs().enabled;
}
