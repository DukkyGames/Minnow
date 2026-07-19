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

  const { row: enabledRow } = createSettingsToggleRow('Enable notifications', {
    checked: prefs.enabled,
    description: 'Show alerts in the menubar bell for background chats, tasks, and jobs.',
    searchKey: 'general.notifications.enabled',
    onChange: (next) => saveNotificationPref('enabled', next),
  });
  mount.appendChild(enabledRow);

  const { row: chatRow } = createSettingsToggleRow('Chat notifications', {
    checked: prefs.chatEnabled,
    description:
      'Alert when a background chat finishes, errors, or a tool fails while you are in another app.',
    searchKey: 'general.notifications.chat',
    onChange: (next) => saveNotificationPref('chatEnabled', next),
  });
  mount.appendChild(chatRow);

  const { row: tasksRow } = createSettingsToggleRow('Task & sub-agent notifications', {
    checked: prefs.tasksEnabled,
    description: 'Orchestrate board updates and sub-agent start, finish, or failure.',
    searchKey: 'general.notifications.tasks',
    onChange: (next) => saveNotificationPref('tasksEnabled', next),
  });
  mount.appendChild(tasksRow);

  const { row: backgroundRow } = createSettingsToggleRow('Background job notifications', {
    checked: prefs.backgroundEnabled,
    description: 'Scheduler reminders, research completion, and memory or skill proposals.',
    searchKey: 'general.notifications.background',
    onChange: (next) => saveNotificationPref('backgroundEnabled', next),
  });
  mount.appendChild(backgroundRow);

  const soundGroup = el('div', 'settings-field');
  soundGroup.dataset.settingsSearchKey = 'general.notifications.sound';
  soundGroup.appendChild(el('span', 'settings-field__label', 'Notification sound'));

  const { row: soundRow } = createSettingsToggleRow('Play sound', {
    checked: prefs.soundEnabled,
    description: 'Play a sound when Minnow is open but another window has focus.',
    onChange: (next) => saveNotificationPref('soundEnabled', next),
  });
  soundGroup.appendChild(soundRow);

  const pickerRow = el('div', 'settings-inline-row');
  const select = document.createElement('select');
  select.className = 'settings-select';
  for (const sound of NOTIFICATION_SOUNDS) {
    const opt = document.createElement('option');
    opt.value = sound.id;
    opt.textContent = sound.label;
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
  soundGroup.appendChild(pickerRow);
  mount.appendChild(soundGroup);

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
