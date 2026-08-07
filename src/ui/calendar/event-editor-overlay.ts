import { appAlert, appConfirm, appPrompt } from '../app-dialog';
/**
 * Calendar event editor — child window for creating and editing events.
 */

import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  type CalendarEvent,
  type CalendarRow,
} from '../../calendar/client';
import {
  CALENDAR_EVENT_EDITOR_INSTANCE_ID,
} from '../../os/calendar-constants';
export interface EventEditorWindowOptions {
  /** Existing event when editing; omit for create. */
  event?: CalendarEvent | null;
  calendars: CalendarRow[];
  onSaved?: () => void | Promise<void>;
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

let overlayRoot: HTMLDivElement | null = null;

/** Whether the calendar event editor overlay is open. */
export function isEventEditorWindowOpen() {
  return Boolean(overlayRoot?.isConnected);
}

/** Close the calendar event editor overlay if open. */
export function closeEventEditorWindow() {
  overlayRoot?.remove();
  overlayRoot = null;
}

/** Open the event editor as a centered overlay on the calendar app. */
export function openEventEditorWindow(options: EventEditorWindowOptions) {
  closeEventEditorWindow();
  const event = options.event ?? null;
  overlayRoot = document.createElement('div');
  overlayRoot.className = 'calendar-event-editor-overlay';
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'calendar-event-editor-overlay__backdrop';
  backdrop.setAttribute('aria-label', 'Close event editor');
  backdrop.addEventListener('click', () => closeEventEditorWindow());
  const dialog = document.createElement('div');
  dialog.className = 'calendar-event-editor-overlay__dialog calendar-event-editor-window-body';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlayRoot.append(backdrop, dialog);
  const host =
    document.getElementById('calendarView') ??
    document.getElementById('osAppsLayer') ??
    document.body;
  host.appendChild(overlayRoot);
  mountEditor(dialog, { ...options, event });
}

function mountEditor(mount: HTMLElement, options: EventEditorWindowOptions & { event: CalendarEvent | null }): void {
  const notify = (state: 'ok' | 'err', message: string) => {
    options.onStatus?.(state, message);
  };

  mount.replaceChildren();

  const panel = document.createElement('section');
  panel.className = 'calendar-event-editor';
  panel.setAttribute('aria-label', 'Event editor');
  mount.appendChild(panel);

  const heading = document.createElement('h4');
  heading.textContent = options.event ? 'Edit event' : 'New event';
  panel.appendChild(heading);

  const form = document.createElement('form');
  form.className = 'calendar-form';
  panel.appendChild(form);

  const event = options.event;

  const titleInput = document.createElement('input');
  titleInput.required = true;
  titleInput.placeholder = 'Title';
  titleInput.value = event?.title ?? '';
  form.appendChild(titleInput);

  const startInput = document.createElement('input');
  startInput.type = 'datetime-local';
  startInput.required = true;
  startInput.value = event ? toLocalInput(event.startsAt) : toLocalInput(new Date().toISOString());
  form.appendChild(startInput);

  const endInput = document.createElement('input');
  endInput.type = 'datetime-local';
  endInput.required = true;
  endInput.value = event
    ? toLocalInput(event.endsAt)
    : toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());
  form.appendChild(endInput);

  const allDayLabel = document.createElement('label');
  allDayLabel.className = 'calendar-check';
  const allDayInput = document.createElement('input');
  allDayInput.type = 'checkbox';
  allDayInput.checked = Boolean(event?.allDay);
  allDayLabel.append(allDayInput, document.createTextNode(' All day'));
  form.appendChild(allDayLabel);

  const locationInput = document.createElement('input');
  locationInput.placeholder = 'Location';
  locationInput.value = event?.location ?? '';
  form.appendChild(locationInput);

  const descInput = document.createElement('textarea');
  descInput.rows = 3;
  descInput.placeholder = 'Description';
  descInput.value = event?.description ?? '';
  form.appendChild(descInput);

  const actions = document.createElement('div');
  actions.className = 'calendar-form-actions';
  form.appendChild(actions);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'calendar-btn calendar-btn--primary';
  saveBtn.textContent = event ? 'Save' : 'Create';
  actions.appendChild(saveBtn);

  if (event) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'calendar-btn calendar-btn--danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        const baseId = event.recurrenceId ?? event.id.split('::')[0];
        if (!await appConfirm('Delete this event?')) {
          return;
        }
        try {
          await deleteCalendarEvent(baseId);
          closeEventEditorWindow();
          notify('ok', 'Event deleted');
          await options.onSaved?.();
        } catch (err) {
          notify('err', err instanceof Error ? err.message : String(err));
        }
      })();
    });
    actions.appendChild(deleteBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'calendar-btn calendar-btn--ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => closeEventEditorWindow());
  actions.appendChild(cancelBtn);

  titleInput.focus();

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void (async () => {
      const calendarId = event?.calendarId ?? options.calendars[0]?.id;
      if (!calendarId) {
        notify('err', 'No calendar available');
        return;
      }
      const payload = {
        title: titleInput.value.trim(),
        calendarId,
        startsAt: fromLocalInput(startInput.value),
        endsAt: fromLocalInput(endInput.value),
        allDay: allDayInput.checked,
        location: locationInput.value.trim() || undefined,
        description: descInput.value.trim() || undefined,
      };
      try {
        if (event) {
          const baseId = event.recurrenceId ?? event.id.split('::')[0];
          await updateCalendarEvent(baseId, payload);
          notify('ok', 'Event updated');
        } else {
          await createCalendarEvent(payload);
          notify('ok', 'Event created');
        }
        closeEventEditorWindow();
        await options.onSaved?.();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : String(err));
      }
    })();
  });
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** Reset module state (tests). */
export function resetEventEditorWindowForTests(): void {
  overlayRoot = null;
}
