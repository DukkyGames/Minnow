/**
 * In-app notification inbox types (MinnowOS menubar bell).
 */

import type { AppId } from '../os/types';

/** Event kinds surfaced in the notification popover. */
export type NotificationKind =
  | 'chat_turn_complete'
  | 'chat_turn_error'
  | 'chat_tool_failure'
  | 'task_started'
  | 'task_complete'
  | 'task_failed'
  | 'task_quarantined'
  | 'board_complete'
  | 'sub_agent_complete'
  | 'sub_agent_failed'
  | 'scheduler'
  | 'research'
  | 'synthesis';

/** One row in the session notification inbox. */
export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  /** Chat name, task title, or app label. */
  title: string;
  /** Snippet shown under the title in the popover. */
  preview: string;
  /** Deep-link into Code app when applicable. */
  chatId?: string;
  /** Fallback launch target when no chat is linked. */
  appId: AppId;
  createdAt: number;
  read: boolean;
  /** Optional dedupe key (not persisted). */
  dedupeKey?: string;
}

/** Input to {@link pushNotification}. */
export type PushNotificationInput = Omit<NotificationRecord, 'id' | 'createdAt' | 'read'> & {
  id?: string;
  createdAt?: number;
  dedupeKey?: string;
};

/** Per-kind enable groups for notification prefs. */
export type NotificationKindGroup = 'chat' | 'tasks' | 'background';

/** User prefs persisted under `minnow.notifications.*`. */
export interface NotificationPrefs {
  enabled: boolean;
  soundEnabled: boolean;
  /** Sound asset id (`none` disables playback). */
  soundId: string;
  chatEnabled: boolean;
  tasksEnabled: boolean;
  backgroundEnabled: boolean;
}

/** Catalog entry for the settings sound picker. */
export interface NotificationSoundOption {
  id: string;
  label: string;
  /** Relative URL under `public/`; omitted for `none`. */
  url?: string;
}
