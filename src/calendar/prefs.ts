/**
 * Client-side calendar display preferences (localStorage).
 */

export type CalendarViewMode = 'month' | 'week';

export interface CalendarPrefs {
  defaultMode: CalendarViewMode;
  maxInlineMonth: number;
  maxInlineWeek: number;
}

const STORAGE_KEY = 'minnow.calendar.prefs';

const DEFAULT_PREFS: CalendarPrefs = {
  defaultMode: 'month',
  maxInlineMonth: 3,
  maxInlineWeek: 8,
};

/** Clamp a number into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parse stored prefs, falling back to defaults for missing or invalid fields. */
function normalizePrefs(raw: Partial<CalendarPrefs> | null | undefined): CalendarPrefs {
  const mode = raw?.defaultMode === 'week' ? 'week' : 'month';
  const maxInlineMonth = clamp(Number(raw?.maxInlineMonth ?? DEFAULT_PREFS.maxInlineMonth), 1, 6);
  const maxInlineWeek = clamp(Number(raw?.maxInlineWeek ?? DEFAULT_PREFS.maxInlineWeek), 3, 15);
  return { defaultMode: mode, maxInlineMonth, maxInlineWeek };
}

/** Read persisted calendar display preferences. */
export function loadCalendarPrefs(): CalendarPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFS };
    }
    return normalizePrefs(JSON.parse(raw) as Partial<CalendarPrefs>);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist calendar display preferences. */
export function saveCalendarPrefs(prefs: CalendarPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePrefs(prefs)));
}

/** Max inline event chips for the active grid mode. */
export function getMaxInlineEvents(mode: CalendarViewMode, prefs?: CalendarPrefs): number {
  const resolved = prefs ?? loadCalendarPrefs();
  return mode === 'week' ? resolved.maxInlineWeek : resolved.maxInlineMonth;
}
