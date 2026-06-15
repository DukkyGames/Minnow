/**
 * Settings → General: notification prefs (master toggle, sounds, per-group toggles).
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

function appendToggleRow(
  parent: HTMLElement,
  label: string,
  hint: string,
  checked: boolean,
  onChange: (next: boolean) => void,
): void {
  const row = el('label', 'settings-toggle-row');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));

  const body = el('span', 'settings-toggle-row__body');
  body.appendChild(el('span', 'settings-toggle-row__label', label));
  if (hint) body.appendChild(el('span', 'settings-field-hint', hint));

  row.append(input, body);
  parent.appendChild(row);
}

/** Render notification controls into a settings group mount. */
export function renderNotificationsSettingsSection(mount: HTMLElement): void {
  const prefs = loadNotificationPrefs();

  appendToggleRow(
    mount,
    'Enable notifications',
    'Show background chat, task, and job alerts in the menubar bell.',
    prefs.enabled,
    (next) => saveNotificationPref('enabled', next),
  );

  appendToggleRow(
    mount,
    'Chat notifications',
    'Turn complete, errors, and tool failures when another chat or app is open.',
    prefs.chatEnabled,
    (next) => saveNotificationPref('chatEnabled', next),
  );

  appendToggleRow(
    mount,
    'Task & sub-agent notifications',
    'Orchestrate board tasks and sub-agent lifecycle events.',
    prefs.tasksEnabled,
    (next) => saveNotificationPref('tasksEnabled', next),
  );

  appendToggleRow(
    mount,
    'Background job notifications',
    'Scheduler reminders, research completion, and auto-learning proposals.',
    prefs.backgroundEnabled,
    (next) => saveNotificationPref('backgroundEnabled', next),
  );

  const soundGroup = el('div', 'settings-field');
  soundGroup.appendChild(el('span', 'settings-field__label', 'Notification sound'));

  appendToggleRow(
    soundGroup,
    'Play sound',
    'Plays when the window is visible but not focused (avoids surprise in background tabs).',
    prefs.soundEnabled,
    (next) => saveNotificationPref('soundEnabled', next),
  );

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

  const previewBtn = el('button', 'settings-btn settings-btn--secondary', 'Preview') as HTMLButtonElement;
  previewBtn.type = 'button';
  previewBtn.addEventListener('click', () => {
    previewNotificationSound(select.value);
  });

  pickerRow.append(select, previewBtn);
  soundGroup.appendChild(pickerRow);
  mount.appendChild(soundGroup);

  const resetBtn = el('button', 'settings-btn settings-btn--ghost', 'Reset to defaults') as HTMLButtonElement;
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    saveNotificationPrefs({
      enabled: true,
      soundEnabled: true,
      soundId: 'chime',
      chatEnabled: true,
      tasksEnabled: true,
      backgroundEnabled: true,
    });
    mount.replaceChildren();
    renderNotificationsSettingsSection(mount);
  });
  mount.appendChild(resetBtn);
}
