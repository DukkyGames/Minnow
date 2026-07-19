/**
 * Settings → Notifications: bell alerts, per-group toggles, and sounds.
 */

import {
  loadNotificationPrefs,
  saveNotificationPref,
  saveNotificationPrefs,
} from '../notifications/prefs';
import {
  NOTIFICATION_SOUNDS,
  previewNotificationSound,
} from '../notifications/sound';
import { appendSettingsGroup } from './settings-layout';
import { createSettingsToggleRow } from './settings-switch';
import { createSettingsActionsRow } from './settings-controls';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Render notification controls into a settings group mount. */
export function renderNotificationsSettingsSection(mount: HTMLElement): void {
  const prefs = loadNotificationPrefs();

  const alerts = appendSettingsGroup(
    mount,
    'Bell alerts',
    'Show alerts in the menubar bell for background chats, tasks, and jobs.',
    'general.notifications',
    { emphasis: true },
  );

  const { row: enabledRow } = createSettingsToggleRow('Enable notifications', {
    checked: prefs.enabled,
    description: 'Master switch for menubar bell alerts.',
    searchKey: 'general.notifications.enabled',
    onChange: (next) => saveNotificationPref('enabled', next),
  });
  alerts.appendChild(enabledRow);

  const { row: chatRow } = createSettingsToggleRow('Chat notifications', {
    checked: prefs.chatEnabled,
    description:
      'Alert when a background chat finishes, errors, or a tool fails while you are in another app.',
    searchKey: 'general.notifications.chat',
    onChange: (next) => saveNotificationPref('chatEnabled', next),
  });
  alerts.appendChild(chatRow);

  const { row: tasksRow } = createSettingsToggleRow('Task & sub-agent notifications', {
    checked: prefs.tasksEnabled,
    description: 'Orchestrate board updates and sub-agent start, finish, or failure.',
    searchKey: 'general.notifications.tasks',
    onChange: (next) => saveNotificationPref('tasksEnabled', next),
  });
  alerts.appendChild(tasksRow);

  const { row: backgroundRow } = createSettingsToggleRow('Background job notifications', {
    checked: prefs.backgroundEnabled,
    description: 'Scheduler reminders, research completion, and memory or skill proposals.',
    searchKey: 'general.notifications.background',
    onChange: (next) => saveNotificationPref('backgroundEnabled', next),
  });
  alerts.appendChild(backgroundRow);

  const sound = appendSettingsGroup(
    mount,
    'Notification sound',
    'Play a sound when Minnow is open but another window has focus.',
    'general.notifications.sound',
    { emphasis: true },
  );

  const { row: soundRow } = createSettingsToggleRow('Play sound', {
    checked: prefs.soundEnabled,
    onChange: (next) => saveNotificationPref('soundEnabled', next),
  });
  sound.appendChild(soundRow);

  const pickerRow = el('div', 'settings-inline-row');
  const select = document.createElement('select');
  select.className = 'settings-select';
  for (const soundOption of NOTIFICATION_SOUNDS) {
    const opt = document.createElement('option');
    opt.value = soundOption.id;
    opt.textContent = soundOption.label;
    select.appendChild(opt);
  }
  select.value = prefs.soundId;
  select.addEventListener('change', () => {
    saveNotificationPref('soundId', select.value);
  });

  const previewBtn = el('button', 'settings-action-btn', 'Preview') as HTMLButtonElement;
  previewBtn.type = 'button';
  previewBtn.addEventListener('click', () => {
    previewNotificationSound(select.value);
  });

  pickerRow.append(select, previewBtn);
  sound.appendChild(pickerRow);

  const resetActions = createSettingsActionsRow([
    {
      label: 'Reset to defaults',
      onClick: () => {
        saveNotificationPrefs({
          enabled: true,
          muted: false,
          soundEnabled: true,
          soundId: 'chime',
          chatEnabled: true,
          tasksEnabled: true,
          backgroundEnabled: true,
        });
        mount.replaceChildren();
        renderNotificationsSettingsSection(mount);
      },
    },
  ]);
  mount.appendChild(resetActions);
}
