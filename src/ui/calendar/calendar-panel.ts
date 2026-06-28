/**
 * Calendar panel — month/week views, event CRUD, ICS import/export, CalDAV sync.
 */

import {
  createCalDavAccount,
  deleteCalDavAccount,
  exportIcsUrl,
  fetchCalDavAccounts,
  fetchCalendars,
  fetchEvents,
  importIcsFile,
  syncCalDav,
  type CalDavAccount,
  type CalendarEvent,
  type CalendarRow,
} from '../../calendar/client';
import { getMaxInlineEvents, loadCalendarPrefs, type CalendarPrefs } from '../../calendar/prefs';
import { openEventEditorWindow } from './event-editor-window';
import { openCalendarSettings } from './calendar-settings';
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
  const initialPrefs = loadCalendarPrefs();
  const state = {
    anchor: new Date(),
    mode: initialPrefs.defaultMode as ViewMode,
    prefs: initialPrefs,
    calendars: [] as CalendarRow[],
    events: [] as CalendarEvent[],
    caldavAccounts: [] as CalDavAccount[],
    visibleCalendarIds: new Set<string>(),
    selectedEventId: null as string | null,
    loading: false,
    caldavFormOpen: false,
    railExpanded: true,
    menuOpen: false,
    dayPopover: null as { day: Date; anchorEl: HTMLElement } | null,
  };

  mount.innerHTML = '';
  mount.className = 'calendar-panel-mount mn-os-window-content calendar-window';

  const toolbar = document.createElement('div');
  toolbar.className = 'calendar-toolbar-compact';
  mount.appendChild(toolbar);

  const navGroup = document.createElement('div');
  navGroup.className = 'calendar-toolbar-compact__nav';
  toolbar.appendChild(navGroup);

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--icon';
  prevBtn.textContent = '←';
  prevBtn.setAttribute('aria-label', 'Previous');
  navGroup.appendChild(prevBtn);

  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'calendar-btn calendar-btn--ghost';
  todayBtn.textContent = 'Today';
  navGroup.appendChild(todayBtn);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--icon';
  nextBtn.textContent = '→';
  nextBtn.setAttribute('aria-label', 'Next');
  navGroup.appendChild(nextBtn);

  const titleEl = document.createElement('h3');
  titleEl.className = 'calendar-title';
  toolbar.appendChild(titleEl);

  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'calendar-toolbar-compact__actions';
  toolbar.appendChild(actionsGroup);

  const modeSelect = document.createElement('select');
  modeSelect.className = 'calendar-select';
  modeSelect.innerHTML = '<option value="month">Month</option><option value="week">Week</option>';
  modeSelect.value = state.mode;
  actionsGroup.appendChild(modeSelect);

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'calendar-btn calendar-btn--primary calendar-btn--icon';
  newBtn.textContent = '+';
  newBtn.setAttribute('aria-label', 'New event');
  actionsGroup.appendChild(newBtn);

  const menuWrap = document.createElement('div');
  menuWrap.className = 'calendar-toolbar-menu';
  actionsGroup.appendChild(menuWrap);

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--icon';
  menuBtn.textContent = '⋯';
  menuBtn.setAttribute('aria-label', 'More actions');
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuWrap.appendChild(menuBtn);

  const menuPanel = document.createElement('div');
  menuPanel.className = 'calendar-toolbar-menu__panel hidden';
  menuPanel.hidden = true;
  menuPanel.setAttribute('role', 'menu');
  menuWrap.appendChild(menuPanel);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'calendar-btn calendar-btn--ghost';
  importBtn.textContent = 'Import ICS';
  importBtn.setAttribute('role', 'menuitem');
  menuPanel.appendChild(importBtn);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'calendar-btn calendar-btn--ghost';
  exportBtn.textContent = 'Export ICS';
  exportBtn.setAttribute('role', 'menuitem');
  menuPanel.appendChild(exportBtn);

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'calendar-btn calendar-btn--ghost';
  syncBtn.textContent = 'Sync CalDAV';
  syncBtn.setAttribute('role', 'menuitem');
  menuPanel.appendChild(syncBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'calendar-btn calendar-btn--ghost';
  settingsBtn.textContent = 'Settings';
  settingsBtn.setAttribute('role', 'menuitem');
  settingsBtn.setAttribute('aria-label', 'Calendar settings');
  menuPanel.appendChild(settingsBtn);

  const dayPopoverEl = document.createElement('div');
  dayPopoverEl.className = 'calendar-day-popover hidden';
  dayPopoverEl.hidden = true;
  dayPopoverEl.setAttribute('role', 'listbox');
  document.body.appendChild(dayPopoverEl);

  const windowBody = document.createElement('div');
  windowBody.className = 'calendar-window-body';
  mount.appendChild(windowBody);

  const rail = document.createElement('aside');
  rail.className = 'calendar-rail';
  windowBody.appendChild(rail);

  const railToggle = document.createElement('button');
  railToggle.type = 'button';
  railToggle.className = 'calendar-rail__toggle';
  railToggle.textContent = '◀';
  railToggle.setAttribute('aria-label', 'Toggle calendars sidebar');
  railToggle.setAttribute('aria-expanded', 'true');
  rail.appendChild(railToggle);

  const railContent = document.createElement('div');
  railContent.className = 'calendar-rail__content';
  rail.appendChild(railContent);

  const calendarList = document.createElement('div');
  calendarList.className = 'calendar-list';
  railContent.appendChild(calendarList);

  const caldavSection = document.createElement('div');
  caldavSection.className = 'calendar-caldav';
  railContent.appendChild(caldavSection);

  const caldavHeader = document.createElement('div');
  caldavHeader.className = 'calendar-caldav-header';
  caldavSection.appendChild(caldavHeader);

  const caldavHeading = document.createElement('h4');
  caldavHeading.textContent = 'CalDAV accounts';
  caldavHeader.appendChild(caldavHeading);

  const addCalDavBtn = document.createElement('button');
  addCalDavBtn.type = 'button';
  addCalDavBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--sm';
  addCalDavBtn.textContent = 'Add account';
  caldavHeader.appendChild(addCalDavBtn);

  const caldavAccountsList = document.createElement('div');
  caldavAccountsList.className = 'calendar-caldav-accounts';
  caldavSection.appendChild(caldavAccountsList);

  const caldavForm = document.createElement('form');
  caldavForm.className = 'calendar-caldav-form hidden';
  caldavSection.appendChild(caldavForm);

  const caldavHint = document.createElement('p');
  caldavHint.className = 'calendar-caldav-hint';
  caldavHint.textContent =
    'Connect Google Calendar, Fastmail, Nextcloud, or any CalDAV server. Passwords are encrypted locally.';
  caldavSection.appendChild(caldavHint);

  const gridWrap = document.createElement('div');
  gridWrap.className = 'calendar-grid-wrap';
  windowBody.appendChild(gridWrap);

  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  gridWrap.appendChild(grid);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.ics,text/calendar';
  fileInput.hidden = true;
  mount.appendChild(fileInput);

  function setStatus(stateKind: 'ok' | 'err', message: string): void {
    options.onStatus?.(stateKind, message);
  }

  function updateTitle(): void {
    const month = state.anchor.toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    titleEl.textContent = state.mode === 'month' ? month : `Week of ${dateKey(buildWeekDays(state.anchor)[0])}`;
  }

  function eventsForDay(day: Date): CalendarEvent[] {
    const key = dateKey(day);
    const matched = state.events.filter((event) => {
      if (!state.visibleCalendarIds.has(event.calendarId)) {
        return false;
      }
      const startKey = event.startsAt.slice(0, 10);
      const endKey = event.endsAt.slice(0, 10);
      return key >= startKey && key <= endKey;
    });
    return matched.sort((a, b) => {
      if (a.allDay !== b.allDay) {
        return a.allDay ? -1 : 1;
      }
      return a.startsAt.localeCompare(b.startsAt);
    });
  }

  /** Close the anchored day popover if open. */
  function closeDayPopover(): void {
    state.dayPopover = null;
    dayPopoverEl.hidden = true;
    dayPopoverEl.classList.add('hidden');
    dayPopoverEl.innerHTML = '';
    for (const trigger of grid.querySelectorAll<HTMLElement>('[aria-expanded="true"]')) {
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  /** Position the popover below (or above) the anchor cell. */
  function positionDayPopover(anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    const margin = 6;
    dayPopoverEl.style.left = `${Math.max(margin, rect.left)}px`;
    dayPopoverEl.style.width = `${Math.max(180, rect.width)}px`;
    dayPopoverEl.hidden = false;
    dayPopoverEl.classList.remove('hidden');

    const popoverHeight = dayPopoverEl.offsetHeight || 200;
    const belowTop = rect.bottom + margin;
    const aboveTop = rect.top - popoverHeight - margin;
    const fitsBelow = belowTop + popoverHeight <= window.innerHeight - margin;
    dayPopoverEl.style.top = `${fitsBelow ? belowTop : Math.max(margin, aboveTop)}px`;
  }

  /** Open a popover listing all events for the given day. */
  function openDayPopover(anchorEl: HTMLElement, day: Date): void {
    const sameAnchor =
      state.dayPopover?.anchorEl === anchorEl && dateKey(state.dayPopover.day) === dateKey(day);
    if (sameAnchor) {
      closeDayPopover();
      return;
    }

    closeDayPopover();
    state.dayPopover = { day, anchorEl };
    anchorEl.setAttribute('aria-expanded', 'true');

    const heading = document.createElement('div');
    heading.className = 'calendar-day-popover-heading';
    heading.textContent = day.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    dayPopoverEl.appendChild(heading);

    const events = eventsForDay(day);
    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'calendar-day-popover-empty';
      empty.textContent = 'No events';
      dayPopoverEl.appendChild(empty);
    } else {
      for (const event of events) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'calendar-day-popover-item';
        item.setAttribute('role', 'option');
        const cal = state.calendars.find((c) => c.id === event.calendarId);
        if (cal) {
          item.style.setProperty('--event-color', cal.color);
        }
        const time = document.createElement('span');
        time.className = 'calendar-day-popover-time';
        time.textContent = formatTime(event.startsAt, event.allDay);
        const title = document.createElement('span');
        title.className = 'calendar-day-popover-title';
        title.textContent = event.title;
        item.append(time, title);
        item.addEventListener('click', () => {
          closeDayPopover();
          openEventEditor(event);
        });
        dayPopoverEl.appendChild(item);
      }
    }

    positionDayPopover(anchorEl);
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

  /** Render configured CalDAV accounts in the sidebar. */
  function renderCalDavAccounts(): void {
    caldavAccountsList.innerHTML = '';
    if (state.caldavAccounts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'calendar-caldav-empty';
      empty.textContent = 'No accounts yet';
      caldavAccountsList.appendChild(empty);
      return;
    }

    for (const account of state.caldavAccounts) {
      const row = document.createElement('div');
      row.className = 'calendar-caldav-row';

      const meta = document.createElement('div');
      meta.className = 'calendar-caldav-meta';
      const label = document.createElement('span');
      label.className = 'calendar-caldav-label';
      const backend =
        account.syncBackend && account.syncBackend !== 'caldav'
          ? ` [${account.syncBackend}]`
          : '';
      label.textContent = `${account.label}${backend}`;
      meta.appendChild(label);
      if (account.lastSyncAt) {
        const synced = document.createElement('span');
        synced.className = 'calendar-caldav-synced';
        synced.textContent = `Last sync ${formatRelativeTime(account.lastSyncAt)}`;
        meta.appendChild(synced);
      }
      row.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'calendar-caldav-actions';

      const syncOneBtn = document.createElement('button');
      syncOneBtn.type = 'button';
      syncOneBtn.className = 'calendar-btn calendar-btn--ghost calendar-btn--sm';
      syncOneBtn.textContent = 'Sync';
      syncOneBtn.addEventListener('click', async () => {
        try {
          await syncCalDav(account.id);
          setStatus('ok', `Synced ${account.label}`);
          await reloadCalDavAccounts();
          await reloadAll();
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : String(err));
        }
      });
      actions.appendChild(syncOneBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'calendar-btn calendar-btn--danger calendar-btn--sm';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        if (!window.confirm(`Remove CalDAV account "${account.label}"?`)) {
          return;
        }
        try {
          await deleteCalDavAccount(account.id);
          setStatus('ok', 'CalDAV account removed');
          await reloadCalDavAccounts();
          await reloadAll();
        } catch (err) {
          setStatus('err', err instanceof Error ? err.message : String(err));
        }
      });
      actions.appendChild(removeBtn);

      row.appendChild(actions);
      caldavAccountsList.appendChild(row);
    }
  }

  /** Show or hide the add-account form in the sidebar. */
  function setCalDavFormOpen(open: boolean): void {
    state.caldavFormOpen = open;
    caldavForm.classList.toggle('hidden', !open);
    addCalDavBtn.textContent = open ? 'Cancel' : 'Add account';
    caldavHint.classList.toggle('hidden', open);
  }

  /** Build the CalDAV account form once and wire submit handling. */
  function mountCalDavForm(): void {
    caldavForm.innerHTML = '';

    const labelInput = document.createElement('input');
    labelInput.required = true;
    labelInput.placeholder = 'Label (e.g. Work)';
    caldavForm.appendChild(labelInput);

    const urlInput = document.createElement('input');
    urlInput.required = true;
    urlInput.type = 'url';
    urlInput.placeholder = 'https://www.google.com/calendar/dav/you@gmail.com/user/';
    caldavForm.appendChild(urlInput);

    const userInput = document.createElement('input');
    userInput.required = true;
    userInput.placeholder = 'Username / email';
    userInput.autocomplete = 'username';
    caldavForm.appendChild(userInput);

    const passInput = document.createElement('input');
    passInput.required = true;
    passInput.type = 'password';
    passInput.placeholder = 'App password';
    passInput.autocomplete = 'current-password';
    caldavForm.appendChild(passInput);

    const formActions = document.createElement('div');
    formActions.className = 'calendar-form-actions';
    caldavForm.appendChild(formActions);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'calendar-btn calendar-btn--primary calendar-btn--sm';
    saveBtn.textContent = 'Save account';
    formActions.appendChild(saveBtn);

    caldavForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await createCalDavAccount({
          label: labelInput.value.trim(),
          url: urlInput.value.trim(),
          username: userInput.value.trim(),
          password: passInput.value,
        });
        setStatus('ok', 'CalDAV account saved');
        setCalDavFormOpen(false);
        caldavForm.reset();
        await reloadCalDavAccounts();
      } catch (err) {
        setStatus('err', err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function reloadCalDavAccounts(): Promise<void> {
    state.caldavAccounts = await fetchCalDavAccounts();
    renderCalDavAccounts();
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
    chip.addEventListener('click', () => openEventEditor(event));
    container.appendChild(chip);
  }

  function renderGrid(): void {
    closeDayPopover();
    grid.innerHTML = '';
    grid.classList.toggle('calendar-grid--week', state.mode === 'week');
    const days = state.mode === 'month' ? buildMonthGrid(state.anchor) : buildWeekDays(state.anchor);
    const maxInline = getMaxInlineEvents(state.mode, state.prefs);

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

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'calendar-cell-date';
      label.textContent = String(day.getUTCDate());
      label.setAttribute('aria-haspopup', 'listbox');
      label.setAttribute('aria-expanded', 'false');
      label.addEventListener('click', () => openDayPopover(label, day));
      cell.appendChild(label);

      const dayEvents = eventsForDay(day);
      const eventsWrap = document.createElement('div');
      eventsWrap.className = 'calendar-cell-events';
      for (const event of dayEvents.slice(0, maxInline)) {
        renderEventChip(event, eventsWrap);
      }
      const overflow = dayEvents.length - maxInline;
      if (overflow > 0) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'calendar-cell-more';
        more.textContent = `+${overflow} more`;
        more.setAttribute('aria-haspopup', 'listbox');
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => openDayPopover(more, day));
        eventsWrap.appendChild(more);
      }
      cell.appendChild(eventsWrap);
      grid.appendChild(cell);
    }
  }

  /** Open the event editor child window for create or edit. */
  function openEventEditor(event: CalendarEvent | null): void {
    closeDayPopover();
    closeToolbarMenu();
    state.selectedEventId = event?.id ?? null;
    openEventEditorWindow({
      event,
      calendars: state.calendars,
      onStatus: setStatus,
      onSaved: reloadEvents,
    });
  }

  function closeToolbarMenu(): void {
    state.menuOpen = false;
    menuPanel.hidden = true;
    menuPanel.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleToolbarMenu(): void {
    state.menuOpen = !state.menuOpen;
    menuPanel.hidden = !state.menuOpen;
    menuPanel.classList.toggle('hidden', !state.menuOpen);
    menuBtn.setAttribute('aria-expanded', state.menuOpen ? 'true' : 'false');
  }

  function applyRailState(): void {
    rail.classList.toggle('calendar-rail--collapsed', !state.railExpanded);
    railToggle.textContent = state.railExpanded ? '◀' : '▶';
    railToggle.setAttribute('aria-expanded', state.railExpanded ? 'true' : 'false');
  }

  function toggleRail(): void {
    state.railExpanded = !state.railExpanded;
    if (state.railExpanded) {
      rail.classList.add('calendar-rail--force-expanded');
    } else {
      rail.classList.remove('calendar-rail--force-expanded');
    }
    applyRailState();
  }

  const layoutObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    const narrow = width < 720;
    windowBody.classList.toggle('calendar-window-body--narrow', narrow);
    if (narrow && !rail.classList.contains('calendar-rail--force-expanded')) {
      state.railExpanded = false;
      applyRailState();
    }
  });
  layoutObserver.observe(windowBody);
  applyRailState();

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
    await reloadCalDavAccounts();
    updateTitle();
    await reloadEvents();
  }

  prevBtn.addEventListener('click', async () => {
    closeDayPopover();
    state.anchor = addDays(state.anchor, state.mode === 'month' ? -30 : -7);
    updateTitle();
    await reloadEvents();
  });

  nextBtn.addEventListener('click', async () => {
    closeDayPopover();
    state.anchor = addDays(state.anchor, state.mode === 'month' ? 30 : 7);
    updateTitle();
    await reloadEvents();
  });

  todayBtn.addEventListener('click', async () => {
    closeDayPopover();
    state.anchor = new Date();
    updateTitle();
    await reloadEvents();
  });

  modeSelect.addEventListener('change', async () => {
    closeDayPopover();
    state.mode = modeSelect.value as ViewMode;
    updateTitle();
    await reloadEvents();
  });

  newBtn.addEventListener('click', () => openEventEditor(null));

  menuBtn.addEventListener('click', () => toggleToolbarMenu());

  railToggle.addEventListener('click', () => toggleRail());

  importBtn.addEventListener('click', () => {
    closeToolbarMenu();
    fileInput.click();
  });

  exportBtn.addEventListener('click', () => {
    closeToolbarMenu();
    const calendarId = state.calendars[0]?.id;
    if (!calendarId) {
      return;
    }
    window.open(exportIcsUrl(calendarId), '_blank');
  });

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

  syncBtn.addEventListener('click', async () => {
    closeToolbarMenu();
    try {
      const accounts = state.caldavAccounts.length
        ? state.caldavAccounts
        : await fetchCalDavAccounts();
      if (accounts.length === 0) {
        setStatus('err', 'Add a CalDAV account in the sidebar first');
        setCalDavFormOpen(true);
        return;
      }
      for (const account of accounts) {
        await syncCalDav(account.id);
      }
      setStatus('ok', `CalDAV sync complete (${accounts.length} account${accounts.length === 1 ? '' : 's'})`);
      await reloadCalDavAccounts();
      await reloadAll();
    } catch (err) {
      setStatus('err', err instanceof Error ? err.message : String(err));
    }
  });

  addCalDavBtn.addEventListener('click', () => {
    setCalDavFormOpen(!state.caldavFormOpen);
  });

  settingsBtn.addEventListener('click', () => {
    closeToolbarMenu();
    void openCalendarSettings({
      calendars: state.calendars,
      onStatus: setStatus,
      onPrefsChanged: (prefs: CalendarPrefs) => {
        state.prefs = prefs;
        state.mode = prefs.defaultMode;
        modeSelect.value = prefs.defaultMode;
        updateTitle();
        renderGrid();
      },
      onCalendarsChanged: reloadAll,
    });
  });

  document.addEventListener('pointerdown', (event) => {
    if (state.menuOpen) {
      const target = event.target as Node;
      if (!menuWrap.contains(target)) {
        closeToolbarMenu();
      }
    }
    if (!state.dayPopover || dayPopoverEl.hidden) {
      return;
    }
    const target = event.target as Node;
    if (dayPopoverEl.contains(target) || state.dayPopover.anchorEl.contains(target)) {
      return;
    }
    closeDayPopover();
  });

  document.addEventListener('keydown', (ev) => {
    if (!mount.isConnected) {
      return;
    }
    if (ev.key === 'Escape') {
      if (state.menuOpen) {
        closeToolbarMenu();
        return;
      }
      if (state.dayPopover) {
        closeDayPopover();
        return;
      }
    }
    if (ev.key === 'ArrowLeft') {
      prevBtn.click();
    } else if (ev.key === 'ArrowRight') {
      nextBtn.click();
    }
  });

  mountCalDavForm();

  await reloadAll();
}

/** Short relative time label for last-sync timestamps. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const deltaMs = Date.now() - then;
  if (!Number.isFinite(then) || deltaMs < 0) {
    return 'just now';
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
