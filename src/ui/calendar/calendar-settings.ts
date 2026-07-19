import { appAlert, appConfirm, appPrompt } from '../app-dialog';
/**
 * In-app Calendar Settings modal — display prefs, calendar CRUD, and reset.
 */

import {
  createCalendar,
  deleteCalendar,
  fetchCalendars,
  resetCalendar,
  updateCalendar,
  type CalendarRow,
} from '../../calendar/client';
import {
  loadCalendarPrefs,
  saveCalendarPrefs,
  type CalendarPrefs,
  type CalendarViewMode,
} from '../../calendar/prefs';

export interface CalendarSettingsOptions {
  calendars: CalendarRow[];
  onStatus?: (state: 'ok' | 'err', message: string) => void;
  onPrefsChanged?: (prefs: CalendarPrefs) => void;
  onCalendarsChanged?: () => Promise<void>;
}

let overlayEl: HTMLDivElement | null = null;

/** Ensure the shared settings overlay exists in the document. */
function ensureOverlay(): HTMLDivElement {
  if (overlayEl) {
    return overlayEl;
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'calendar-settings-overlay hidden';
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div class="calendar-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="calendarSettingsTitle">
      <header class="calendar-settings-header">
        <h3 id="calendarSettingsTitle">Calendar settings</h3>
        <button type="button" class="calendar-btn calendar-btn--ghost calendar-btn--sm" data-cal-settings-close aria-label="Close">✕</button>
      </header>
      <div class="calendar-settings-body" data-cal-settings-body></div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) {
      closeCalendarSettings();
    }
  });

  const closeBtn = overlayEl.querySelector('[data-cal-settings-close]');
  closeBtn?.addEventListener('click', () => closeCalendarSettings());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlayEl && !overlayEl.hidden) {
      closeCalendarSettings();
    }
  });

  return overlayEl;
}

/** Close the settings modal if open. */
export function closeCalendarSettings(): void {
  if (!overlayEl) {
    return;
  }
  overlayEl.hidden = true;
  overlayEl.classList.add('hidden');
}

/** Open the calendar settings modal. */
export async function openCalendarSettings(options: CalendarSettingsOptions): Promise<void> {
  const overlay = ensureOverlay();
  const body = overlay.querySelector('[data-cal-settings-body]') as HTMLElement;
  body.innerHTML = '';

  const prefs = loadCalendarPrefs();
  let calendars = [...options.calendars];

  const setStatus = (kind: 'ok' | 'err', message: string): void => {
    options.onStatus?.(kind, message);
  };

  const refreshCalendars = async (): Promise<void> => {
    await options.onCalendarsChanged?.();
    calendars = await fetchCalendars();
    renderCalendarRows();
  };

  const displaySection = document.createElement('section');
  displaySection.className = 'calendar-settings-section';
  displaySection.innerHTML = '<h4>Display</h4>';
  body.appendChild(displaySection);

  const modeLabel = document.createElement('label');
  modeLabel.className = 'calendar-settings-field';
  modeLabel.textContent = 'Default view';
  const modeSelect = document.createElement('select');
  modeSelect.innerHTML = '<option value="month">Month</option><option value="week">Week</option>';
  modeSelect.value = prefs.defaultMode;
  modeLabel.appendChild(modeSelect);
  displaySection.appendChild(modeLabel);

  const monthLimitLabel = document.createElement('label');
  monthLimitLabel.className = 'calendar-settings-field';
  monthLimitLabel.textContent = 'Max inline events (month)';
  const monthLimitInput = document.createElement('input');
  monthLimitInput.type = 'number';
  monthLimitInput.min = '1';
  monthLimitInput.max = '6';
  monthLimitInput.value = String(prefs.maxInlineMonth);
  monthLimitLabel.appendChild(monthLimitInput);
  displaySection.appendChild(monthLimitLabel);

  const weekLimitLabel = document.createElement('label');
  weekLimitLabel.className = 'calendar-settings-field';
  weekLimitLabel.textContent = 'Max inline events (week)';
  const weekLimitInput = document.createElement('input');
  weekLimitInput.type = 'number';
  weekLimitInput.min = '3';
  weekLimitInput.max = '15';
  weekLimitInput.value = String(prefs.maxInlineWeek);
  weekLimitLabel.appendChild(weekLimitInput);
  displaySection.appendChild(weekLimitLabel);

  const saveDisplayBtn = document.createElement('button');
  saveDisplayBtn.type = 'button';
  saveDisplayBtn.className = 'calendar-btn calendar-btn--primary calendar-btn--sm';
  saveDisplayBtn.textContent = 'Save display settings';
  displaySection.appendChild(saveDisplayBtn);

  saveDisplayBtn.addEventListener('click', () => {
    const next: CalendarPrefs = {
      defaultMode: modeSelect.value as CalendarViewMode,
      maxInlineMonth: Number(monthLimitInput.value),
      maxInlineWeek: Number(weekLimitInput.value),
    };
    saveCalendarPrefs(next);
    options.onPrefsChanged?.(next);
    setStatus('ok', 'Display settings saved');
  });

  const calendarsSection = document.createElement('section');
  calendarsSection.className = 'calendar-settings-section';
  calendarsSection.innerHTML = '<h4>Your calendars</h4>';
  body.appendChild(calendarsSection);

  const calendarRowsEl = document.createElement('div');
  calendarRowsEl.className = 'calendar-settings-calendars';
  calendarsSection.appendChild(calendarRowsEl);

  const addCalendarBtn = document.createElement('button');
  addCalendarBtn.type = 'button';
  addCalendarBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--sm';
  addCalendarBtn.textContent = 'Add calendar';
  calendarsSection.appendChild(addCalendarBtn);

  const caldavNote = document.createElement('p');
  caldavNote.className = 'calendar-settings-note';
  caldavNote.textContent = 'CalDAV accounts are managed in the sidebar.';
  calendarsSection.appendChild(caldavNote);

  function renderCalendarRows(): void {
    calendarRowsEl.innerHTML = '';
    for (const cal of calendars) {
      const row = document.createElement('div');
      row.className = 'calendar-settings-calendar-row';

      const nameInput = document.createElement('input');
      nameInput.value = cal.name;
      nameInput.placeholder = 'Calendar name';
      row.appendChild(nameInput);

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = cal.color;
      colorInput.title = 'Calendar color';
      row.appendChild(colorInput);

      const saveCalBtn = document.createElement('button');
      saveCalBtn.type = 'button';
      saveCalBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--sm';
      saveCalBtn.textContent = 'Save';
      saveCalBtn.addEventListener('click', async () => {
        try {
          await updateCalendar(cal.id, {
            name: nameInput.value.trim(),
            color: colorInput.value,
          });
          setStatus('ok', `Updated "${nameInput.value.trim()}"`);
          await refreshCalendars();
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : String(err));
        }
      });
      row.appendChild(saveCalBtn);

      if (cal.source === 'local') {
        const deleteCalBtn = document.createElement('button');
        deleteCalBtn.type = 'button';
        deleteCalBtn.className = 'calendar-btn calendar-btn--danger calendar-btn--sm';
        deleteCalBtn.textContent = 'Delete';
        deleteCalBtn.addEventListener('click', async () => {
          if (!await appConfirm(`Delete calendar "${cal.name}" and all its events?`)) {
            return;
          }
          try {
            await deleteCalendar(cal.id);
            setStatus('ok', 'Calendar deleted');
            await refreshCalendars();
          } catch (err) {
            setStatus('err', err instanceof Error ? err.message : String(err));
          }
        });
        row.appendChild(deleteCalBtn);
      } else {
        const syncedBadge = document.createElement('span');
        syncedBadge.className = 'calendar-settings-synced';
        syncedBadge.textContent = 'Synced';
        row.appendChild(syncedBadge);
      }

      calendarRowsEl.appendChild(row);
    }
  }

  renderCalendarRows();

  addCalendarBtn.addEventListener('click', async () => {
    const name = await appPrompt('New calendar name');
    if (!name?.trim()) {
      return;
    }
    try {
      await createCalendar({ name: name.trim() });
      setStatus('ok', 'Calendar created');
      await refreshCalendars();
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    }
  });

  const dangerSection = document.createElement('section');
  dangerSection.className = 'calendar-settings-section calendar-settings-section--danger';
  dangerSection.innerHTML = '<h4>Danger zone</h4>';
  body.appendChild(dangerSection);

  const dangerText = document.createElement('p');
  dangerText.className = 'calendar-settings-danger-text';
  dangerText.textContent =
    'Reset removes all events, CalDAV accounts, and calendars, then restores a fresh Personal calendar.';
  dangerSection.appendChild(dangerText);

  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'calendar-settings-field';
  const confirmInput = document.createElement('input');
  confirmInput.placeholder = 'Type RESET to confirm';
  confirmLabel.append(confirmInput);
  dangerSection.appendChild(confirmLabel);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'calendar-btn calendar-btn--danger calendar-btn--sm';
  resetBtn.textContent = 'Reset calendar';
  resetBtn.disabled = true;
  dangerSection.appendChild(resetBtn);

  confirmInput.addEventListener('input', () => {
    resetBtn.disabled = confirmInput.value.trim() !== 'RESET';
  });

  resetBtn.addEventListener('click', async () => {
    if (confirmInput.value.trim() !== 'RESET') {
      return;
    }
    if (!await appConfirm('This cannot be undone. Reset all calendar data?')) {
      return;
    }
    try {
      await resetCalendar();
      setStatus('ok', 'Calendar reset complete');
      confirmInput.value = '';
      resetBtn.disabled = true;
      await refreshCalendars();
      closeCalendarSettings();
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    }
  });

  overlay.hidden = false;
  overlay.classList.remove('hidden');
  modeSelect.focus();
}
