# Odysseus Port 05 — Scheduled Tasks And Reminders

Tier: 2  
Effort: M-L  
Priority: Medium  
Status: Planned  
Depends on: #12 for stored prompts/channels that may contain secrets  
Linear: [MIN-120](https://linear.app/minnowai/issue/MIN-120/odysseus-port-05-scheduled-tasks-and-reminders)

## Goal

Add local recurring jobs and reminders so Minnow can run agent tasks on an interval or cron schedule while the app/server is running. Initial scope is in-app/browser reminders; email and webhook delivery attach after their own plans ship.

V1 scope: user-defined interval/cron jobs + run-now. Odysseus built-in action tasks, crew execution, model slots, and note scanning are deferred.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** (encrypt job prompts with secrets) |
| npm packages | Optional: `cron-parser` or `croner` for cron (evaluate vs hand-rolled) |
| External binaries | `node bin/minnow.mjs` for headless job execution |
| Runtime constraint | Jobs run **only while Minnow server is running** — document clearly |
| Estimated effort | 5–8 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| `server/scheduler/` module | Store, schedule, runner, delivery |
| Job CRUD API | `/api/scheduler/jobs` |
| Tick loop | Started from `server/runtime/bootstrap.js` |
| Headless execution | Spawn `minnow run --json` subprocess |
| In-app delivery | Notification queue + client poll → `noteAgentMessage()` |
| Settings or app UI | Job list, create/edit, run-now |
| Cron support | Phase 2 after interval jobs prove stable |

## Verified Source Context

- Odysseus reference: `src/task_scheduler.py` — `TaskScheduler`, `compute_next_run()`.
- Odysseus reminder dispatch: `routes/note_routes.py`.
- Minnow headless runner: `src/headless/runner.ts` → `runHeadless(options)` (client TS — **not** importable from server).
- OS notifications: `noteAgentMessage()` in `src/os/instances.ts`, UI in `src/os/notifications-menu.ts`.
- Server bootstrap: `server/runtime/bootstrap.js`.
- Config home: `server/config/home.js`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/scheduler/store.js` | `~/.minnow/scheduler.json` CRUD |
| `server/scheduler/schedule.js` | Interval + cron next-run calculation |
| `server/scheduler/runner.js` | Subprocess headless invocation |
| `server/scheduler/delivery.js` | Notification queue persistence |
| `server/scheduler/middleware.js` | API routes |
| `server/scheduler/tick.js` | Interval tick loop + due-job dispatch |
| `src/ui/settings-scheduler.ts` OR `src/ui/scheduler-page.ts` | Job management UI |
| `test/scheduler/store.test.mjs` | Job validation, cap |
| `test/scheduler/schedule.test.mjs` | Next-run calculation |
| `test/scheduler/runner.test.mjs` | Fake subprocess tests |

## Files to Modify

| Path | Change |
|------|--------|
| `server/runtime/bootstrap.js` | Start scheduler tick on server boot |
| `server/runtime/middlewares.js` | Register scheduler middleware |
| `src/main.ts` or scheduler client | Poll notifications → `noteAgentMessage()` |
| `src/ui/settings-sections.ts` OR MinnowOS app | Scheduler UI entry point |
| `documentation/context.md` | Document scheduler limitations |

## Data Model

### Job (`~/.minnow/scheduler.json`)

```ts
interface ScheduledJob {
  id: string;
  label: string;
  enabled: boolean;
  schedule: { kind: 'interval' | 'cron'; value: string };
  // interval value: "60s" | "5m" | "2h" — minimum 60s
  // cron value: standard 5-field cron expression
  prompt: string;
  modeId: string;
  workAgentId?: string;
  providerId?: string;
  modelId?: string;
  workspacePath?: string;
  channels: Array<'in_app' | 'email' | 'webhook'>;
  lastRunAt?: string;
  nextRunAt?: string;
  running?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Run history (`~/.minnow/scheduler-runs/<jobId>.json` — capped)

```ts
interface SchedulerRun {
  id: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  exitCode?: number;
  output?: string; // truncated stdout JSON
  error?: string;
}
```

### Notifications (`~/.minnow/scheduler-notifications.json`)

```ts
interface SchedulerNotification {
  id: string;
  jobId: string;
  label: string;
  message: string;
  createdAt: string;
  acked: boolean;
}
```

## API Routes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/scheduler/jobs` | List all jobs |
| POST | `/api/scheduler/jobs` | Create job (validate schedule, cap count) |
| PUT | `/api/scheduler/jobs/:id` | Update job |
| DELETE | `/api/scheduler/jobs/:id` | Delete job |
| POST | `/api/scheduler/jobs/:id/run` | Run now (bypass schedule) |
| GET | `/api/scheduler/notifications` | Unacked notifications |
| POST | `/api/scheduler/notifications/:id/ack` | Mark read |
| GET | `/api/scheduler/runs/:jobId` | Recent run history |

## Detailed Implementation Phases

### Phase 1 — Store and CRUD (1.5 days)

1. `server/scheduler/store.js`:
   - Atomic read/write `scheduler.json`.
   - Max jobs: 50 (configurable).
   - Validate: `schedule.kind`, minimum interval 60s, non-empty prompt.
   - Compute `nextRunAt` on create/update via `schedule.js`.
2. `server/scheduler/middleware.js` — CRUD routes above.
3. Register in `server/runtime/middlewares.js`.
4. Tests: validation rejects bad cron, cap enforced.

### Phase 2 — Interval scheduling (1 day)

1. `server/scheduler/schedule.js`:
   - `parseInterval("5m")` → milliseconds.
   - `computeNextRun(job, now)` → ISO timestamp.
   - Do not backfill missed runs after restart — schedule next from `now`.
2. `server/scheduler/tick.js`:
   - `setInterval` every 15s (or configurable).
   - Find due jobs (`enabled && nextRunAt <= now && !running`).
   - Global concurrency cap: 2 simultaneous runs.
3. Per-job non-overlap lock: skip if `running === true`.
4. Tests: fixed `now` fixtures for next-run math.

### Phase 3 — Headless execution (2 days)

1. `server/scheduler/runner.js`:
   - **Do not** import `src/headless/runner.ts` from server code.
   - Spawn: `node bin/minnow.mjs run --json --prompt "..." --mode <modeId> --provider <id> --model <id> --workspace <path> --no-start-server` (exact flags per CLI help).
   - Timeout: 10 minutes default (configurable per job).
   - Capture stdout (JSON), stderr, exit code.
   - Persist run record to `scheduler-runs/`.
   - On completion: update `lastRunAt`, recompute `nextRunAt`, clear `running`.
2. Tests: mock `child_process.spawn` with fixture stdout.
3. Integration test: tick → spawn → persisted result (optional, may be slow).

### Phase 4 — In-app delivery (1 day)

1. `server/scheduler/delivery.js`:
   - On job completion: write `SchedulerNotification` to queue file.
   - Message: truncated output summary or "Job failed: …".
2. Client poll (every 30s in `src/main.ts` or dedicated module):
   - `GET /api/scheduler/notifications`.
   - For each unacked: call `noteAgentMessage('scheduler', label, message)` — **client only**.
   - `POST .../ack` after delivery.
3. Optional: Electron `Notification` API from client after queue delivery.
4. Tests: dedupe by notification id, ack removes from unacked list.

### Phase 5 — Cron support (1 day)

1. Add `cron` kind to schedule parser (use `cron-parser` or `croner` if hand-rolled is error-prone).
2. Timezone: use system local timezone; document DST behavior.
3. Tests: fixed dates across DST boundary (US/Europe fixtures).

### Phase 6 — Settings UI (1 day)

1. Job list: label, schedule, enabled toggle, last/next run, actions (edit, delete, run-now).
2. Create/edit form: all job fields, channel checkboxes (in_app only in v1).
3. Run history panel per job.
4. Warning banner: "Jobs only run while Minnow is open."

### Phase 7 — External channels (after #6, #9)

- `email` channel → #9 SMTP send with user-configured account.
- `webhook` channel → #6 `fire_and_forget` with job completion payload.
- `ntfy` → optional later phase.

## Implementation TODOs

- [ ] Add scheduler store and validation
- [ ] Add interval support first
- [ ] Add run-now route
- [ ] Start the tick loop from `server/runtime/bootstrap.js`
- [ ] Add non-overlap locking per job
- [ ] Add in-app delivery through a client/server notification bridge
- [ ] Add cron support
- [ ] Add optional `ntfy` channel as a later reminder-delivery phase, or document it as out of scope
- [ ] Add Scheduler settings section or MinnowOS app
- [ ] Add email/webhook channel hooks after #9/#6
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_task_scheduler_session_delivery.py` | delivery.js |
| `tests/test_scheduler_restart_doublefire.py` | no backfill on restart |
| `tests/test_compute_next_run_monthly_clamp.py` | cron edge cases |

## Acceptance Criteria

- A 60-second interval job runs while Minnow is running.
- Run-now executes immediately and records output.
- The same job cannot overlap with itself.
- Jobs persist after restart and recompute next run.
- In-app reminder delivery appears in the notifications surface through the client bridge.

## Verification

- Add scheduler store and schedule calculation tests
- Add runner tests with a fake headless runner
- Add subprocess integration coverage for scheduler tick to `minnow run` to persisted result
- Add reminder dedupe tests based on fixed timestamps
- Manual: create a short-interval job, observe completion, restart, and confirm it reloads
- Manual: disable a job and confirm it no longer fires

## Risks And Guardrails

- Jobs run only while Minnow is running; document this clearly.
- Prompt and channel config may contain secrets; route sensitive values through #12.
- Cap concurrent jobs globally.
- Never auto-send email or external webhooks unless the user configured those channels.
