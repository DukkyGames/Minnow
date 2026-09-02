/**
 * Session in-memory notification inbox with pub/sub.
 */

import { randomUUID } from '../lib/random-id.ts';
import type { NotificationRecord } from './types';

const MAX_ITEMS = 100;

type StoreListener = (snapshot: readonly NotificationRecord[]) => void;

const items: NotificationRecord[] = [];
const listeners = new Set<StoreListener>();
const dedupeKeys = new Set<string>();

function snapshot(): readonly NotificationRecord[] {
  return [...items];
}

function emit(): void {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {}
  }
}

function newId(): string {
  return randomUUID();
}

/** All inbox rows, newest first. */
export function getNotifications(): readonly NotificationRecord[] {
  return snapshot();
}

/** Unread count for menubar badge. */
export function getUnreadNotificationCount(): number {
  return items.filter((n) => !n.read).length;
}

/** Unread count filtered by app id (dock open indicators). */
export function getUnreadCountForApp(appId: NotificationRecord['appId']): number {
  return items.filter((n) => !n.read && n.appId === appId).length;
}

/** Subscribe to inbox changes; returns unsubscribe. */
export function subscribeNotifications(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when dedupe key was already used this session. */
export function hasDedupeKey(key: string): boolean {
  return dedupeKeys.has(key);
}

/** Remember a dedupe key for the session. */
export function rememberDedupeKey(key: string): void {
  dedupeKeys.add(key);
}

/** Append a notification row (caller handles dedupe + cap). */
export function appendNotification(record: NotificationRecord): NotificationRecord {
  items.unshift(record);
  while (items.length > MAX_ITEMS) {
    items.pop();
  }
  emit();
  return record;
}

/** Mark one notification read by id. */
export function markNotificationRead(id: string): void {
  const row = items.find((n) => n.id === id);
  if (!row || row.read) return;
  row.read = true;
  emit();
}

/** Mark every unread inbox row linked to a chat (opening the thread dismisses its alerts). */
export function markNotificationsReadForChat(chatId: string): void {
  const trimmed = chatId.trim();
  if (!trimmed) return;
  let changed = false;
  for (const row of items) {
    if (!row.read && row.chatId === trimmed) {
      row.read = true;
      changed = true;
    }
  }
  if (changed) emit();
}

/** Mark all notifications read. */
export function markAllNotificationsRead(): void {
  if (!items.some((n) => !n.read)) return;
  for (const row of items) {
    row.read = true;
  }
  emit();
}

/** Reset store (tests). */
export function resetNotificationStoreForTests(): void {
  items.length = 0;
  dedupeKeys.clear();
  listeners.clear();
}
