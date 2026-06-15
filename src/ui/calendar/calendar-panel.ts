/**
 * Calendar panel — month/week views, event CRUD, ICS import/export, CalDAV sync.
 */

import {
  createCalendarEvent,
  deleteCalendarEvent,
  exportIcsUrl,
  fetchCalDavAccounts,
  fetchCalendars,
  fetchEvents,
  importIcsFile,
  syncCalDav,
  updateCalendarEvent,
  type CalendarEvent,
  type CalendarRow,
} from '../../calendar/client';

export interface CalendarPanelOptions {
  onStatus?: (state: 'ok' | 'err', message: string) => void;
}

type ViewMode = 'month' | 'week';

/** Start of month for the visible grid. */
function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Add days to a UTC date. */
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** ISO date key YYYY-MM-DD. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Format a short time label for event chips. */
function formatTime(iso: string, allDay?: boolean): string {
  if (allDay) {
    return 'All day';
  }
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Build month grid days (42 cells). */
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const weekday = first.getUTCDay();
  const gridStart = addDays(first, -weekday);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Build week day headers. */
function buildWeekDays(anchor: Date): Date[] {
  const weekday = anchor.getUTCDay();
  const weekStart = addDays(anchor, -weekday);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Visible range for fetching events. */
function visibleRange(anchor: Date, mode: ViewMode): { from: string; to: string } {
  if (mode === 'week') {
    const days = buildWeekDays(anchor);
    const from = new Date(`${dateKey(days[0])}T00:00:00.000Z`);
    const to = new Date(`${dateKey(days[6])}T23:59:59.999Z`);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const grid = buildMonthGrid(anchor);
  const from = new Date(`${dateKey(grid[0])}T00:00:00.000Z`);
  const to = new Date(`${dateKey(grid[grid.length - 1])}T23:59:59.999Z`);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function renderCalendarPanel(
  mount: HTMLElement,
  options: CalendarPanelOptions = {},
): Promise<void> {
  const state = {
    anchor: new Date(),
    mode: 'month' as ViewMode,
    calendars: [] as CalendarRow[],
    events: [] as CalendarEvent[],
    visibleCalendarIds: new Set<string>(),
    selectedEventId: null as string | null,
    loading: false,
  };

  mount.innerHTML = '';
  mount.className = 'calendar-panel-mount';

  const panel = document.createElement('div');
  panel.className = 'calendar-panel';
  mount.appendChild(panel);

  const toolbar = document.createElement('div');
  toolbar.className = 'calendar-toolbar';
  panel.appendChild(toolbar);

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'calendar-btn';
  prevBtn.textContent = '←';
  prevBtn.setAttribute('aria-label', 'Previous');
  toolbar.appendChild(prevBtn);

  const titleEl = document.createElement('h3');
  titleEl.className = 'calendar-title';
  toolbar.appendChild(titleEl);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'calendar-btn';
  nextBtn.textContent = '→';
  nextBtn.setAttribute('aria-label', 'Next');
  toolbar.appendChild(nextBtn);

  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'calendar-btn calendar-btn--ghost';
  todayBtn.textContent = 'Today';
  toolbar.appendChild(todayBtn);

  const modeSelect = document.createElement('select');
  modeSelect.className = 'calendar-select';
  modeSelect.innerHTML = '<option value="month">Month</option><option value="week">Week</option>';
  toolbar.appendChild(modeSelect);

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'calendar-btn calendar-btn--primary';
  newBtn.textContent = 'New event';
  toolbar.appendChild(newBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'calendar-btn calendar-btn--ghost';
  importBtn.textContent = 'Import ICS';
  toolbar.appendChild(importBtn);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'calendar-btn calendar-btn--ghost';
  exportBtn.textContent = 'Export ICS';
  toolbar.appendChild(exportBtn);

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'calendar-btn calendar-btn--ghost';
  syncBtn.textContent = 'Sync CalDAV';
  toolbar.appendChild(syncBtn);

  const layout = document.createElement('div');
  layout.className = 'calendar-layout';
  panel.appendChild(layout);

  const sidebar = document.createElement('aside');
  sidebar.className = 'calendar-sidebar';
  layout.appendChild(sidebar);

  const calendarList = document.createElement('div');
  calendarList.className = 'calendar-list';
  sidebar.appendChild(calendarList);

  const main = document.createElement('div');
  main.className = 'calendar-main';
  layout.appendChild(main);

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  main.appendChild(grid);

  const drawer = document.createElement('aside');
  drawer.className = 'calendar-drawer hidden';
  panel.appendChild(drawer);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.ics,text/calendar';
  fileInput.hidden = true;
  panel.appendChild(fileInput);

  function setStatus(stateKind: 'ok' | 'err', message: string): void {
    options.onStatus?.(stateKind, message);
  }

  function updateTitle(): void {
    const month = state.anchor.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    titleEl.textContent = state.mode === 'month' ? month : `Week of ${dateKey(buildWeekDays(state.anchor)[0])}`;
  }

  function eventsForDay(day: Date): CalendarEvent[] {
    const key = dateKey(day);
    return state.events.filter((event) => {
      if (!state.visibleCalendarIds.has(event.calendarId)) {
        return false;
      }
      const startKey = event.startsAt.slice(0, 10);
      const endKey = event.endsAt.slice(0, 10);
      return key >= startKey && key <= endKey;
    });
  }

  function renderCalendarList(): void {
    calendarList.innerHTML = '';
    const heading = document.createElement('h4');
    heading.textContent = 'Calendars';
    calendarList.appendChild(heading);

    for (const cal of state.calendars) {
      const row = document.createElement('label');
      row.className = 'calendar-list-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.visibleCalendarIds.has(cal.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.visibleCalendarIds.add(cal.id);
        } else {
          state.visibleCalendarIds.delete(cal.id);
        }
        renderGrid();
      });
      const swatch = document.createElement('span');
      swatch.className = 'calendar-swatch';
      swatch.style.background = cal.color;
      const name = document.createElement('span');
      name.textContent = cal.name;
      row.append(checkbox, swatch, name);
      calendarList.appendChild(row);
    }
  }

  function renderEventChip(event: CalendarEvent, container: HTMLElement): void {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'calendar-event-chip';
    const cal = state.calendars.find((c) => c.id === event.calendarId);
    if (cal) {
      chip.style.setProperty('--event-color', cal.color);
    }
    chip.textContent = `${formatTime(event.startsAt, event.allDay)} ${event.title}`;
    if (event.conflict) {
      chip.title = 'Sync conflict';
      chip.classList.add('is-conflict');
    }
    chip.addEventListener('click', () => openDrawer(event));
    container.appendChild(chip);
  }

  function renderGrid(): void {
    grid.innerHTML = '';
    grid.classList.toggle('calendar-grid--week', state.mode === 'week');
    const days = state.mode === 'month' ? buildMonthGrid(state.anchor) : buildWeekDays(state.anchor);

    for (const day of days) {
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      const inMonth = day.getUTCMonth() === state.anchor.getUTCMonth();
      if (state.mode === 'month' && !inMonth) {
        cell.classList.add('is-outside');
      }
      if (dateKey(day) === dateKey(new Date())) {
        cell.classList.add('is-today');
      }

      const label = document.createElement('div');
      label.className = 'calendar-cell-date';
      label.textContent = String(day.getUTCDate());
      cell.appendChild(label);

      const eventsWrap = document.createElement('div');
      eventsWrap.className = 'calendar-cell-events';
      for (const event of eventsForDay(day).slice(0, 3)) {
        renderEventChip(event, eventsWrap);
      }
      const overflow = eventsForDay(day).length - 3;
      if (overflow > 0) {
        const more = document.createElement('div');
        more.className = 'calendar-cell-more';
        more.textContent = `+${overflow} more`;
        eventsWrap.appendChild(more);
      }
      cell.appendChild(eventsWrap);
      grid.appendChild(cell);
    }
  }

  function openDrawer(event: CalendarEvent | null): void {
    drawer.innerHTML = '';
    drawer.classList.remove('hidden');
    state.selectedEventId = event?.id ?? null;

    const heading = document.createElement('h4');
    heading.textContent = event ? 'Edit event' : 'New event';
    drawer.appendChild(heading);

    const form = document.createElement('form');
    form.className = 'calendar-form';
    drawer.appendChild(form);

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
      deleteBtn.addEventListener('click', async () => {
        const baseId = event.recurrenceId ?? event.id.split('::')[0];
        if (!window.confirm('Delete this event?')) {
          return;
        }
        try {
          await deleteCalendarEvent(baseId);
          drawer.classList.add('hidden');
          setStatus('ok', 'Event deleted');
          await reloadEvents();
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : String(err));
        }
      });
      actions.appendChild(deleteBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'calendar-btn calendar-btn--ghost';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => drawer.classList.add('hidden'));
    actions.appendChild(closeBtn);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const calendarId = event?.calendarId ?? state.calendars[0]?.id;
      if (!calendarId) {
        setStatus('err', 'No calendar available');
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
          setStatus('ok', 'Event updated');
        } else {
          await createCalendarEvent(payload);
          setStatus('ok', 'Event created');
        }
        drawer.classList.add('hidden');
        await reloadEvents();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function reloadEvents(): Promise<void> {
    state.loading = true;
    try {
      const range = visibleRange(state.anchor, state.mode);
      state.events = await fetchEvents(range);
      renderGrid();
    } finally {
      state.loading = false;
    }
  }

  async function reloadAll(): Promise<void> {
    state.calendars = await fetchCalendars();
    if (state.visibleCalendarIds.size === 0) {
      for (const cal of state.calendars) {
        state.visibleCalendarIds.add(cal.id);
      }
    }
    renderCalendarList();
    updateTitle();
    await reloadEvents();
  }

  prevBtn.addEventListener('click', async () => {
    state.anchor = addDays(state.anchor, state.mode === 'month' ? -30 : -7);
    updateTitle();
    await reloadEvents();
  });

  nextBtn.addEventListener('click', async () => {
    state.anchor = addDays(state.anchor, state.mode === 'month' ? 30 : 7);
    updateTitle();
    await reloadEvents();
  });

  todayBtn.addEventListener('click', async () => {
    state.anchor = new Date();
    updateTitle();
    await reloadEvents();
  });

  modeSelect.addEventListener('change', async () => {
    state.mode = modeSelect.value as ViewMode;
    updateTitle();
    await reloadEvents();
  });

  newBtn.addEventListener('click', () => openDrawer(null));

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    const calendarId = state.calendars[0]?.id;
    if (!file || !calendarId) {
      return;
    }
    try {
      const count = await importIcsFile(calendarId, file);
      setStatus('ok', `Imported ${count} event(s)`);
      await reloadEvents();
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    }
  });

  exportBtn.addEventListener('click', () => {
    const calendarId = state.calendars[0]?.id;
    if (!calendarId) {
      return;
    }
    window.open(exportIcsUrl(calendarId), '_blank');
  });

  syncBtn.addEventListener('click', async () => {
    try {
      const accounts = await fetchCalDavAccounts();
      if (accounts.length === 0) {
        setStatus('err', 'No CalDAV accounts configured');
        return;
      }
      await syncCalDav(accounts[0].id);
      setStatus('ok', 'CalDAV sync complete');
      await reloadAll();
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (!mount.isConnected) {
      return;
    }
    if (ev.key === 'ArrowLeft') {
      prevBtn.click();
    } else if (ev.key === 'ArrowRight') {
      nextBtn.click();
    }
  });

  await reloadAll();
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}
