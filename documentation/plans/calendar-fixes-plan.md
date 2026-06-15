# Calendar App Fixes and Settings

**Status:** Implemented in worktree `calendar-fixes-a3f7b2c1`.

## Problem summary

| Issue | Root cause |
|-------|------------|
| `+N more` does nothing | Plain `<div>` with no handler in [`calendar-panel.ts`](../../src/ui/calendar/calendar-panel.ts) |
| Week view shows only 3 events | Same hardcoded `slice(0, 3)` for both month and week — not view-specific |
| No settings / reset | CalDAV + visibility live in sidebar only; no wipe API in [`store.js`](../../server/calendar/store.js) |
| Tool returns max 50 events | Intentional cap in [`tool-handler.js`](../../server/calendar/tool-handler.js); truncation was silent |

## Shipped changes

### 1. Overflow popover
- Cell-anchored day popover for `+N more` and date-label clicks
- Events sorted by `startsAt` (all-day first)
- Dismiss via Escape, outside click, or toggle same trigger

### 2. Week inline limits
- [`src/calendar/prefs.ts`](../../src/calendar/prefs.ts) — `minnow.calendar.prefs` in localStorage
- Month default: 3 inline chips; week default: 8
- `renderGrid()` calls `eventsForDay()` once per cell

### 3. Calendar Settings modal
- [`src/ui/calendar/calendar-settings.ts`](../../src/ui/calendar/calendar-settings.ts)
- Toolbar **Settings** button
- Display prefs, local calendar CRUD, danger-zone reset (`RESET` typed confirm)

### 4. Backend
- `resetCalendarData()`, `deleteCalendar()` in store
- `POST /api/calendar/reset`, `PUT`/`DELETE /api/calendar/calendars/:id`
- Client helpers in [`src/calendar/client.ts`](../../src/calendar/client.ts)

### 5. Tool pagination
- `manage_calendar` list: `limit` (default 50, max 200) + `offset`
- Truncation message with next-page hint

### 6. Tests
- [`test/calendar/store.test.mjs`](../../test/calendar/store.test.mjs) — reset
- [`test/calendar/reset-api.test.mjs`](../../test/calendar/reset-api.test.mjs) — API guard
- [`test/calendar/tool-handler.test.mjs`](../../test/calendar/tool-handler.test.mjs) — pagination

## Verification checklist

- [x] Day overflow opens popover with full sorted list
- [x] Week view uses 8 inline chips by default
- [x] Settings persist default view and limits
- [x] Reset wipes data; Personal calendar remains
- [x] `manage_calendar list` reports `50 of 60` and offset hint
- [x] `npm run test:calendar` passes
