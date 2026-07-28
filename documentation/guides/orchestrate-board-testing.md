# Orchestrate board testing

How to run, debug, and extend tests for the Orchestrate Kanban board (dispatcher, task chats, merge/quarantine, board log). Product context: [Orchestrate boards in `context.md`](../context.md#orchestrate-boards).

## Three layers

| Layer | When to use | Command / entry |
|-------|----------------|-----------------|
| **Automated suite** | CI, regressions, every PR | `npm run test:board` (~14s, 397 tests) |
| **Board log validation** | Post-mortem on a real or test run | `npm run check:board-log -- <groupId>` |
| **Manual UI + fake model** | Click through the real app without a live LLM | `npm run seed:test-board` + `npm run fake-model -- --register` |

```text
                    npm run test:board
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  Unit / component   Live launch path   Headless full-stack
  (store, merge,     (real startTask,    (real runChatTurn +
   quarantine…)      scripted turns)     fetch router + quirks)
```

The automated suite is the main safety net. It exercises the **real launch path** (`startTask`, slot accounting, stream-end ordering) that older tests skipped via `MINNOW_TEST` guards and harness reimplementation.

---

## Quick start (developers)

```bash
# Run all orchestrate tests
npm run test:board

# Typecheck (same as CI)
npx tsc --noEmit
```

Full CI also runs `npm test` (all suites) and `npm run test:check-coverage`.

---

## Manual UI workflow (fake model)

Use this when you want to watch the Kanban in Electron without LM Studio.

### 1. Start the fake provider

```bash
npm run fake-model -- --register
```

Leave this terminal open. `--register` writes provider `fake-board` to `~/.minnow/providers/`.

### 2. Seed a ready-made board

```bash
npm run seed:test-board
# or auto-start immediately:
npm run seed:test-board -- --mode auto --auto-start
```

This skips onboarding and `board_init` — the planner chat and Kanban already exist in `~/.minnow/sessions`.

| Flag | Default | Purpose |
|------|---------|---------|
| `--preset quick` | quick | 3 parallel W1 tasks ([`test-board-quick.md`](../plans/test-board-quick.md)) |
| `--preset smoke` | | 6-task smoke plan ([`orchestrator-board-smoke.md`](../plans/orchestrator-board-smoke.md)) |
| `--workspace <path>` | cwd | Workspace folder to bind |
| `--mode manual\|auto\|sequential` | manual | Execution mode |
| `--provider` / `--model` | `fake-board` / `fake-board-model` | Planner model binding |
| `--auto-start` | off | Set `board.autoRunning` |

Re-run anytime to reset the same board (stable IDs). **Restart Minnow** if it was open during seeding.

### 3. Open Minnow

```bash
npm start
# or
npm run desktop
```

Open the seeded workspace. The chat **Test board (quick)** should appear with the board view ready.

### 4. Verify the fake model is used

- Planner chat must use **Fake board model** (`fake-board`). Settings alone does not retarget an existing board — switch the model on the **planner chat** via the composer picker.
- The fake-model terminal should log `POST /v1/chat/completions` with `role=builder|tester|…`.

### 5. Validate the run log (optional)

```bash
npm run check:board-log -- grp_a0000000-0000-4000-8000-000000000001
```

Use your real `groupId` from the board folder if different.

---

## Commands reference

| Command | Description |
|---------|-------------|
| `npm run test:board` | All `test/orchestrate/**/*.test.{mts,mjs}` (~397 tests) |
| `npm run fake-model` | Local OpenAI-v1 stub; `npm run fake-model -- --help` |
| `npm run seed:test-board` | Inject pre-initialized board into sessions |
| `npm run check:board-log -- <groupId\|path>` | Validate `~/.minnow/logs/orchestrate/*.jsonl` |

### `check-board-log`

```bash
npm run check:board-log -- grp_abc123
npm run check:board-log -- ~/.minnow/logs/orchestrate/grp_abc123.jsonl --json

# Wave / dependency ordering needs a plan graph:
npm run check:board-log -- grp_abc123 --plan plan.json
```

`plan.json` shape:

```json
{
  "tasks": [
    { "id": "W1-A", "wave": "W1" },
    { "id": "W2-A", "wave": "W2", "dependsOn": ["W1-A"] }
  ],
  "waveOrder": ["W1", "W2"],
  "expectFinalTest": true
}
```

Without `--plan`, `wave-order` and `dependency-order` invariants are skipped.

### `fake-model` scenario format

Optional `--scenario path.json` — ordered steps; first match wins:

```json
[
  {
    "match": { "role": "builder", "taskId": "W1-A", "nth": 0 },
    "emit": ["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"]
  }
]
```

Default (no `--scenario`): builder `nth=0` → `board_report` for that task; `nth≥1` → prose ack; tester → `VERDICT: pass`; final → `FULL_BOARD` report.

---

## Test architecture

### Launch path and `MINNOW_TEST`

Under `node:test`, `process.env.MINNOW_TEST=1` is set by [`test/test-loader.mjs`](../../test/test-loader.mjs).

By default, background board chat launches are **suppressed** (no real `startTask`, worktree fetches, or supervision timers). Tests that opt into the real path install a turn runner:

```ts
import { setBoardChatTurnRunner } from '../../src/state/orchestrate-board-actions.ts';
import { createScriptedTurnRunner } from './_scripted-turn-runner.mts';

const runner = createScriptedTurnRunner({ script: myScript });
runner.install();
// … drive board …
runner.restore(); // also clears supervision intervals
```

Headless E2E wraps real `runChatTurn` with a custom runner (must not be the `runChatTurn` reference directly — use an `async (input) => runChatTurn(input)` wrapper).

### Harness modules (`test/orchestrate/_*.mts`)

| Module | Role |
|--------|------|
| [`_board-flow-helpers.mts`](../../test/orchestrate/_board-flow-helpers.mts) | `seedBoard`, `driveBoardToConvergence`, `driveLiveBoard`, worktree mocks, `installBoardTestDom` |
| [`_scripted-turn-runner.mts`](../../test/orchestrate/_scripted-turn-runner.mts) | Scripted `boardChatTurnRunner`; reproduces stream-end contract |
| [`_headless-board-dom.mts`](../../test/orchestrate/_headless-board-dom.mts) | happy-dom stubs for full `runChatTurn` |
| [`_fake-api-router.mts`](../../test/orchestrate/_fake-api-router.mts) | `globalThis.fetch` router for generations, tools, worktree |
| [`_board-quirk-fixtures.mts`](../../test/orchestrate/_board-quirk-fixtures.mts) | Model-misbehaviour SSE scenarios (families A–H) |

**LLM-quirk TDD:** See [orchestrate-board-llm-quirk-tdd.md](../plans/orchestrate-board-llm-quirk-tdd.md) for the full scenario matrix and **known red** backlog. New quirk tests assert **intended** behaviour; `npm run test:board` may fail until product fixes land — do not weaken assertions.

**Drive modes:**

- `driveBoardToConvergence` (default) — uses `bootstrapPendingLaunches` when launches are suppressed; legacy harness path.
- `driveLiveBoard` — real dispatcher + `setBoardChatTurnRunner`; use for launch-path tests.

### Board log invariants

[`src/state/board-log-invariants.ts`](../../src/state/board-log-invariants.ts) — pure checker over `BoardLogEvent[]`:

| Invariant | What it checks |
|-----------|----------------|
| `status-transitions` | Legal status edges |
| `verdict-after-start` | No verdict before first `task_started` |
| `attempt-caps` | Retries/nudges within caps |
| `merge-integrity` | One merge per completed task |
| `final-test-order` | Final test start/verdict ordering |
| `wave-order` | Wave barriers (needs `--plan`) |
| `dependency-order` | `dependsOn` respected (needs `--plan`) |
| `quarantine-cascade` | Root quarantine + dependent cascade |

Concurrency is **not** inferred from logs — assert slots in live-launch tests instead.

Unit tests: [`board-log-invariants.test.mts`](../../test/orchestrate/board-log-invariants.test.mts).

---

## Test file index

All files under [`test/orchestrate/`](../../test/orchestrate/). Run one file:

```bash
npx tsx --import ./test/test-loader.mjs --import ./test/assert-dom-safe.mjs \
  --experimental-test-module-mocks --test test/orchestrate/board-live-launch.test.mts
```

### End-to-end harnesses

| File | Focus |
|------|--------|
| `board-flow-e2e.test.mts` | Multi-wave lifecycle via bootstrap harness |
| `board-live-launch.test.mts` | Real launch path, slots, supervision, concurrency |
| `board-headless-e2e.test.mts` | Full `runChatTurn` + quirk fixtures (families A–H) |
| `board-log-invariants.test.mts` | Invariant checker fixtures |
| `merge-fixer-llm-quirks.test.mts` | Fixer LLM nonsense (family D) |

### Launch, stream-end, recovery

| File | Focus |
|------|--------|
| `task-stream-end.test.mts` | Stream-end subscriber ordering |
| `task-recovery.test.mts` | Stall recovery / resume |
| `fixer-recovery.test.mts` | Merge-fixer recovery |
| `merge-fixer-stall.test.mts` | Fixer stall detection |
| `merge-fixer-resume.test.mts` | Fixer resume after stop |
| `merge-fixer-finalize.test.mts` | Fixer finalize path |
| `env-fixer-stall.test.mts` | Env fixer stall |
| `board-task-chat-stall.test.mts` | Task chat stall restarts |
| `user-stopped.test.mts` | User stop during board run |
| `build-failure-preserve.test.mts` | Build failure state preservation |

### Self-heal, quarantine, testing phase

| File | Focus |
|------|--------|
| `orchestrate-self-heal.test.mts` | Self-heal routing |
| `orchestrate-quarantine-completion.test.mts` | Quarantine + completion |
| `quarantine-completion-hooks.test.mts` | Quarantine completion hooks |
| `task-build-retry.test.mts` | Build retry limits |
| `task-testing.test.mts` | Tester phase / verdict |

### Store, tools, delegation

| File | Focus |
|------|--------|
| `board-store.test.mts` | Board store mutators |
| `board-log.test.mts` | Board log append/rotation |
| `board-report.test.mts` | `board_report` tool |
| `delegate-tasks.test.mts` | `delegate_tasks` |
| `pipeline-holds.test.mts` | Merge pipeline holds (MIN-409) |
| `plan-complete.test.mts` | Plan completion detection |
| `plan-complete-ui.test.mts` | Plan-complete UI |
| `finish-report.test.mts` | Finish report delivery |
| `orchestrator-board-link.test.mts` | Planner ↔ board linking |
| `orchestrate-send-gate.test.mts` | Send gating during board run |
| `orchestrate-failure-classify.test.mts` | Failure classification |
| `list-plans.test.mts` | Plan discovery |
| `worktree-isolation.test.mts` | Worktree isolation modes |

### UI / stats / misc

| File | Focus |
|------|--------|
| `board-timeline-drawer.test.mts` | Timeline drawer |
| `board-timer.test.mts` | Board timer |
| `board-stats-aggregate.test.mts` | Board stats rollup |
| `stats-aggregate.test.mts` | Stats math |
| `last-activity.test.mjs` | Last-activity timestamps |

---

## Adding tests

### New quirk (model misbehaviour)

1. Add an SSE scenario to [`_board-quirk-fixtures.mts`](../../test/orchestrate/_board-quirk-fixtures.mts) and register in `quirkFixtures` — use `generationErrorEndSse` / `generationPostErrorTurn` for context-window overflow; see `CONTEXT_EXCEEDED_MESSAGES`.
2. Add a case to [`board-headless-e2e.test.mts`](../../test/orchestrate/board-headless-e2e.test.mts) (or the relevant unit suite for dispatcher-only edges).
3. Assert final task statuses **and** `checkBoardLog(events, opts).ok` where the board converges.
4. If documenting a known product gap, add the test to **Known red** in [orchestrate-board-llm-quirk-tdd.md](../plans/orchestrate-board-llm-quirk-tdd.md).

New tests assert **intended** recovery behaviour and may stay red until product fixes land.

### New launch-path behaviour

1. Extend [`_scripted-turn-runner.mts`](../../test/orchestrate/_scripted-turn-runner.mts) or [`_board-flow-helpers.mts`](../../test/orchestrate/_board-flow-helpers.mts).
2. Add a test in `board-live-launch.test.mts` or `board-flow-e2e.test.mts`.
3. Prefer `driveLiveBoard` over `bootstrapPendingLaunches` when testing dispatcher/slot bugs.

### New board-log invariant

1. Extend [`board-log-invariants.ts`](../../src/state/board-log-invariants.ts).
2. Add passing + failing fixtures in `board-log-invariants.test.mts`.
3. Wire into headless E2E assertions where relevant.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Fake model loops on `board_report` | Missing post-tool prose turn | Restart fake-model (fixed in default scenario) |
| Board ignores fake model | Planner chat still bound to old provider | Switch model on **planner chat** composer picker |
| `issuesState is not initialized` in test output | Plan-complete hook; Issues not loaded | Benign in tests; ignore or init Issues store |
| Seed script hangs | `scheduleSaveSessions` after `initBoard` | Wait or Ctrl+C after "Seeded test board" prints |
| `check-board-log` skips wave/dependency | No `--plan` | Pass plan JSON with task graph |
| Tests fail loading UI CSS | Missing test-loader | Use `npm run test:board` (correct runner profile) |

---

## Related docs

- [Command reference](commands.md) — all npm scripts
- [Orchestrate boards (`context.md`)](../context.md#orchestrate-boards) — architecture reference
- [Orchestrator board smoke plan](../plans/orchestrator-board-smoke.md) — manual smoke checklist
- [Test board quick plan](../plans/test-board-quick.md) — minimal 3-task plan
