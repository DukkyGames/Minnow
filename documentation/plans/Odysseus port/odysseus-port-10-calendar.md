# Odysseus Port 10 — Calendar, CalDAV, And ICS

Tier: 3  
Effort: L-XL  
Priority: Later  
Status: Planned  
Depends on: #12  
Pairs with: #5 Scheduler  
Linear: [MIN-129](https://linear.app/minnowai/issue/MIN-129/odysseus-port-10-calendar-caldav-and-ics)

## Goal

Add a local-first calendar with event CRUD, `.ics` import/export, CalDAV sync, and agent-assisted event management. Ship local event storage first, then recurrence and sync.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** (CalDAV credentials), **#5** (reminder dispatch integration) |
| npm packages | `better-sqlite3` (recommended store), `rrule` (recurrence), `ical.js` or `node-ical` (ICS parse/generate), `tsdav` or `caldav` (CalDAV client) |
| Test server | Radicale, Nextcloud, or Fastmail CalDAV for manual sync QA |
| Estimated effort | 10–15 days (local CRUD + ICS); +8 days for CalDAV |

## Prerequisites & Deliverables

| Phase | Deliverable |
|-------|-------------|
| P1 | SQLite store + local CRUD API |
| P2 | Calendar MinnowOS app (month/week/list views) |
| P3 | ICS import/export + recurrence expansion |
| P4 | CalDAV bidirectional sync |
| P5 | `manage_calendar` agent tool |
| P6 | Upcoming events → #5 reminder dispatch |

## Verified Source Context

- Odysseus references:
  - `routes/calendar_routes.py` — `EventCreate`/`EventUpdate`
  - `src/caldav_sync.py` — `validate_caldav_url()`, `sync_caldav()`
  - `src/caldav_writeback.py` — `build_event_ical()`, `push_event()`
- Minnow scheduler #5: calendar reminders feed reminder dispatch, not direct scheduler storage polling.
- Tool definitions: `src/tools/definitions.ts`.
- MinnowOS: add `calendar` to `src/os/types.ts`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/calendar/store.js` | SQLite schema + CRUD |
| `server/calendar/recurrence.js` | RRULE expansion for date ranges |
| `server/calendar/ics.js` | Import/export |
| `server/calendar/caldav.js` | Account sync + SSRF validation |
| `server/calendar/caldav-writeback.js` | Push local changes |
| `server/calendar/middleware.js` | `/api/calendar` routes |
| `src/ui/calendar-page.ts` | Calendar app UI |
| `src/styles/calendar.css` | Styles |
| `test/calendar/store.test.mjs` | CRUD + fixed timestamps |
| `test/calendar/recurrence.test.mjs` | DST/timezone fixtures |
| `test/calendar/ics-roundtrip.test.mjs` | Import/export parity |
| `test/calendar/caldav-sync.test.mjs` | Mocked server responses |

## Files to Modify

| Path | Change |
|------|--------|
| `src/os/types.ts` | Add `'calendar'` to `AppId` |
| `src/os/app-registry.ts` | Register Calendar |
| `src/os/app-host.ts` | Calendar layer |
| `index.html` | `#calendarView` |
| `server/runtime/middlewares.js` | Register calendar middleware |
| `src/tools/definitions.ts` | `manage_calendar` tool (P5) |
| `server/scheduler/delivery.js` | Upcoming event reminders (P6) |
| `documentation/context.md` | Document calendar + sync |

## Storage decision

**Prefer SQLite** (`~/.minnow/calendar/calendar.db`) for Odysseus parity:

| Table | Columns |
|-------|---------|
| `calendars` | `id`, `name`, `color`, `source` (local\|caldav), `account_id` |
| `events` | `id`, `calendar_id`, `title`, `description`, `location`, `starts_at`, `ends_at`, `timezone`, `all_day`, `rrule`, `recurrence_id`, `source`, `remote_href`, `remote_etag`, `updated_at` |
| `caldav_accounts` | `id`, `label`, `url`, `username`, `secret_ref`, `last_sync_at` |
| `sync_state` | `account_id`, `calendar_href`, `sync_token` |

JSON flat-file is acceptable only if SQLite dependency is rejected — document tradeoff.

## Data Model

```ts
interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;   // ISO 8601
  endsAt: string;
  timezone?: string;  // IANA, e.g. America/New_York
  allDay?: boolean;
  rrule?: string;     // RFC 5545 RRULE string
  recurrenceId?: string;
  source?: 'local' | 'caldav' | 'ics' | 'agent';
  remote?: { accountId: string; href: string; etag?: string };
  updatedAt: string;
}
```

## API Routes

| Method | Path | Phase |
|--------|------|-------|
| GET | `/api/calendar/calendars` | P1 |
| POST | `/api/calendar/calendars` | P1 |
| GET | `/api/calendar/events` | P1 — `?calendarId=&from=&to=` |
| POST | `/api/calendar/events` | P1 |
| PUT | `/api/calendar/events/:id` | P1 |
| DELETE | `/api/calendar/events/:id` | P1 |
| POST | `/api/calendar/import/ics` | P3 — multipart upload |
| GET | `/api/calendar/export/ics` | P3 — `?calendarId=` |
| GET | `/api/calendar/caldav/accounts` | P4 |
| POST | `/api/calendar/caldav/accounts` | P4 |
| POST | `/api/calendar/caldav/sync` | P4 — manual sync |
| GET | `/api/calendar/upcoming` | P6 — `?hours=24` for #5 reminders |

## Detailed Implementation Phases

### Phase 1 — Local CRUD (3 days)

1. `server/calendar/store.js`:
   - Init SQLite schema on first use.
   - Default local calendar ("Personal", color from theme accent).
   - CRUD with validation: `endsAt > startsAt`, non-empty title.
2. Routes via `middleware.js`.
3. Tests: create/update/delete with fixed ISO timestamps.

### Phase 2 — Calendar app UI (4 days)

1. Add `calendar` MinnowOS app.
2. `src/ui/calendar-page.ts`:
   - **Month view:** grid with event dots/chips.
   - **Week/list view:** dense schedule for selected range.
   - **Event detail drawer:** view/edit/delete.
   - **Create event form:** title, dates, all-day toggle, location, description.
   - **Calendar list sidebar:** colors, visibility toggles.
   - Keyboard: arrow keys navigate dates; Enter opens detail.
3. Source-contract tests.

### Phase 3 — ICS import/export (3 days)

1. `server/calendar/ics.js`:
   - Parse with `ical.js` / `node-ical` — test against fixed `.ics` fixtures from Odysseus.
   - Support `VEVENT`, all-day (`VALUE=DATE`), timed, `RRULE`.
   - `recurrence.js`: expand occurrences for visible date range via `rrule` package.
   - Export: generate valid `.ics` with proper escaping (port Odysseus export escaping tests).
2. UI: import button (file picker), export per calendar.
3. Tests: round-trip — import fixture → export → re-import → matching core fields.

### Phase 4 — CalDAV sync (5 days)

1. `server/calendar/caldav.js`:
   - Account CRUD with #12 encrypted credentials.
   - `validate_caldav_url()` — SSRF guard (reuse #6 `ssrf.js` patterns): private IPs, DNS rebinding.
   - Sync: fetch remote calendars + events by `href` + `etag`.
   - Last-write-wins with conflict metadata surfaced in UI (`remote_etag` mismatch → "Conflict" badge).
   - Manual sync first; optional interval sync (opt-in per account).
2. `caldav-writeback.js`: push local creates/updates/deletes.
3. Tests: mocked CalDAV PROPFIND/REPORT/PUT responses.
4. Manual: sync against Radicale or Nextcloud test calendar.

### Phase 5 — Agent tool (2 days)

1. `manage_calendar` in `definitions.ts`:
   - `action`: `list` | `create` | `update` | `delete` | `find_free_time`.
   - Args: date range, calendar id, event fields.
   - `delete` requires confirmation via tool approval flow or `ask_question`.
   - Output bounded and date-scoped (max 50 events per list).
2. Handler in `tools-middleware.js`.

### Phase 6 — Scheduler integration (1 day)

1. `GET /api/calendar/upcoming?hours=24` returns events starting within window.
2. #5 reminder dispatch polls this endpoint (or receives push on sync) — **do not** have scheduler read calendar DB directly.
3. In-app notification: "Event in 15 minutes: {title}".

## Implementation TODOs

- [ ] Add local calendar/event store
- [ ] Decide SQLite vs JSON store before implementation; prefer SQLite for Odysseus parity
- [ ] Add CRUD routes
- [ ] Add Calendar app shell and local CRUD UI
- [ ] Add `.ics` import/export
- [ ] Add recurrence expansion with timezone tests
- [ ] Add encrypted CalDAV account config
- [ ] Add bidirectional CalDAV sync
- [ ] Add `manage_calendar` tool
- [ ] Integrate upcoming events with #5 reminder dispatch rather than direct scheduler storage polling
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_calendar_*.py` (12 files) | store, API |
| `tests/test_ics_*.py` | ics-roundtrip |
| `tests/test_caldav_*.py` (9 files) | caldav-sync |

## Acceptance Criteria

- Users can create, edit, and delete local events.
- Events persist across reload.
- Importing recurring `.ics` fixtures shows expected occurrences.
- Exported `.ics` can be re-imported with matching core fields.
- CalDAV sync creates/updates events both directions against a test server.
- Agent can create a calendar event through `manage_calendar`.

## Verification

- Add store CRUD tests with fixed timestamps
- Add recurrence/timezone tests with static expected occurrences
- Add ICS round-trip fixture tests
- Manual: sync against a Radicale or Nextcloud test calendar
- Manual: use agent tool to create an event, then view it in Calendar

## Risks And Guardrails

- Recurrence and timezones are the highest correctness risk.
- CalDAV conflict handling must not silently delete remote data.
- Credentials depend on #12.
- Agent deletes must require confirmation.
- Keep local CRUD useful even without CalDAV.
