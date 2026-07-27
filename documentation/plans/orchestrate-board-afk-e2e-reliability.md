# Orchestrate board AFK end-to-end reliability plan

**Status:** proposed  
**Scope:** test architecture, failure injection, AFK acceptance, and reliability feedback loops  
**Primary surfaces:** Orchestrate runtime, board testing API, Settings → Advanced → Board testing, CI  
**Related:** [`orchestrate-board-testing.md`](../guides/orchestrate-board-testing.md), [`orchestrate-board-llm-quirk-tdd.md`](orchestrate-board-llm-quirk-tdd.md), [`orchestrate-board-model-rethink.md`](orchestrate-board-model-rethink.md)

## Goal

Make AFK board execution demonstrably hands-off. A board must either:

1. converge to a valid terminal result without user input, or
2. stop in a bounded, diagnosable terminal state with preserved work and a complete failure artifact.

"Cover every possible edge case" cannot mean manually listing every failure string or timing interleaving. The sustainable target is:

- enumerate every failure **boundary**;
- generate combinations within those boundaries;
- enforce total state-transition and safety properties;
- inject deterministic faults at production-adjacent seams;
- run repeated crash, retry, and concurrency scenarios;
- retain artifacts for every non-converging run.

## Current baseline

The current system is stronger than the basic Settings UI suggests:

- `npm run test:board` runs about 397 tests.
- `board-live-launch.test.mts` uses real task launch, supervision, and slot accounting.
- `board-headless-e2e.test.mts` uses real `runChatTurn` with intercepted generations, tools, and worktree APIs.
- `_board-quirk-fixtures.mts` covers model-output families A–H.
- board JSONL logs have eight structural invariants.
- the Settings board-testing page can start a fake model, seed a board, and validate a completed log.

The reliability gap is not raw test count. It is that the layers use different scenario formats, mock different boundaries, and do not prove an actual AFK run survives faults, reloads, and integration failures.

### Confirmed gaps

- No automated E2E runs a complete board with `executionMode: 'afk'`.
- The Settings fake model only runs its happy default; CLI-only scenarios cannot be selected in the UI.
- The headless quirk catalog and fake-model scenario schema are separate systems.
- Automated E2E mocks all git/worktree operations.
- No automated test drives the live server plus fake provider plus persisted sessions as one process topology.
- Reload tests do not cover all ephemeral runtime maps and pipeline phases.
- Concurrency cannot be reconstructed from current board logs.
- The UI cannot start, monitor, repeat, stop, or export an AFK scenario.
- Five intended recovery behaviors are documented as known red.
- A timing-sensitive fixer recovery case can intermittently add another failure.
- Some invariant checks are skipped in headless E2E because production events are incomplete.

## Reliability contract

AFK is ready only when all guarantees below are executable acceptance checks.

### Liveness

- Every ready task is eventually launched, queued with a reason, or moved to a bounded terminal state.
- Every launched phase eventually completes, retries within policy, or terminates.
- A full board eventually reaches:
  - all eligible tasks complete and final integration passed; or
  - a blocked result with quarantined roots and dependents.
- Restarting the app does not strand a task in a non-terminal state without an active or recoverable owner.

### Safety

- Dependency and wave gates are never bypassed.
- Running and held work never exceeds the effective concurrency cap.
- At most one integration operation mutates the integration worktree at a time.
- Final integration never overlaps task mutation.
- User stop does not burn retry budgets.
- System recovery never silently discards partial work.
- A superseded chat or fixer cannot finalize the current lifecycle.
- Retry, notification, merge, planner-report, and completion effects are idempotent.
- AFK never opens a blocking question, approval, confirmation, or mode-switch UI.

### Bounded recovery

- Every retry family has a persisted or reconstructible budget.
- Missing reports, stalls, build failures, test failures, environment failures, merge failures, and final-test failures have explicit terminal behavior.
- Repeated identical faults cannot create an unbounded nudge or self-heal loop.
- Expired holds, lost queues, and interrupted generations recover after reload without duplicate launches.

### Diagnosability

- Every phase start, phase end, retry decision, slot acquire/release, hold acquire/release, integration action, and terminal decision is recorded.
- A failed run exports board state, scenario, fake-model request trace, board log, invariant violations, and relevant chat/run identifiers.
- Test output distinguishes product failure, harness failure, expected quarantine, and timeout.

## Target test architecture

Keep one scenario catalog and execute it through multiple adapters.

```text
Scenario catalog
  ├─ reducer/property runner       state/event completeness
  ├─ live-launch runner            scheduler, slots, supervision
  ├─ headless runChatTurn runner   SSE, tools, contracts, recovery
  ├─ persisted server runner       sessions, API, fake provider, restart
  └─ Electron walkthrough runner   visible board and blocking-UI checks
            │
            └─ common assertions + artifact bundle
```

### Layer 1 — pure model and property tests

Purpose: prove total state behavior without chats, timers, HTTP, or git.

- Drive a task reducer with generated event sequences.
- Assert transition legality, bounded attempts, idempotence, and terminal convergence.
- Generate task DAGs and verify ready-set and quarantine-cascade properties.
- Generate interleavings of slot, queue, hold, and stream-end events.
- Use deterministic seeds and print the seed and minimized sequence on failure.

This layer depends on the pure reducer proposed in `orchestrate-board-model-rethink.md`. Before that refactor, introduce a read-only canonical snapshot and transition oracle around the existing engine so properties can begin landing without waiting for the rewrite.

### Layer 2 — focused runtime contract tests

Purpose: keep fast tests for each boundary and failure policy.

- Stream parsing and generation endings.
- Builder/tester/fixer/final structured reports.
- Failure classification.
- Retry and self-heal decisions.
- Worktree API result handling.
- Persistence normalization and hydration.
- Board-log invariants.

### Layer 3 — live launch E2E

Purpose: exercise real dispatch, launch reservations, supervision, queue drains, and concurrency.

- Keep scripted turns.
- Use a deterministic virtual clock.
- Do not inject task outcomes directly when the behavior under test depends on stream completion.
- Assert no slot, hold, timer, queue, or subscription leak after every run.
- Add AFK as a first-class execution mode in this runner.

### Layer 4 — headless tool-loop E2E

Purpose: exercise real `runChatTurn`, SSE parsing, tool calls, role filtering, and stream-end finalization.

- Make this the authoritative model-misbehavior layer.
- Route all quirk fixtures through a shared scenario schema.
- Remove `allowSettleTimeout` once each known red behavior is fixed.
- Require full invariant checks; fix missing production events instead of skipping invariants.
- Add AFK tool-policy assertions from the tool catalog used by the actual turn.

### Layer 5 — persisted server E2E

Purpose: exercise the process topology that unit and in-memory harnesses miss.

Run:

- the real tool server with isolated `MINNOW_HOME`;
- the real sessions repository;
- the in-process fake OpenAI provider over HTTP;
- real board-testing endpoints;
- temporary real git repositories and worktrees;
- controlled server/app restarts at named checkpoints.

This layer may use a headless board driver, but it must not replace persistence, provider HTTP, worktree, or log APIs with a fetch router.

### Layer 6 — Electron AFK smoke

Purpose: prove the shipped UI can start and remain hands-off.

Keep this small:

- open a seeded AFK board;
- run one happy multi-wave scenario;
- run one recoverable fault scenario;
- assert no question, permission, confirmation, or mode-switch overlay appears;
- capture a short video and final board screenshot;
- validate the resulting log.

Do not duplicate the full quirk matrix in Electron.

## Unified scenario model

Create a production-neutral scenario type under `src/dev/orchestrate-scenarios/`; test code and the board-testing server both import it.

```ts
type BoardScenario = {
  id: string;
  family: string;
  description: string;
  preset: 'quick' | 'smoke' | 'generated';
  executionMode: 'afk' | 'auto' | 'sequential';
  expected: {
    boardOutcome: 'passed' | 'blocked';
    taskStatuses?: Record<string, string>;
    maxRetries?: Partial<Record<string, number>>;
  };
  faults: ScenarioFault[];
  restartCheckpoints?: ScenarioCheckpoint[];
};
```

`ScenarioFault` should target semantic boundaries, not raw implementation callbacks:

- generation request;
- generation stream;
- tool execution;
- report contract;
- task launch;
- timer/heartbeat;
- session save/load;
- worktree create;
- task commit;
- integration merge;
- integration verify;
- planner report;
- notification;
- process restart.

Each fault includes:

- target role, task, phase, and occurrence;
- deterministic trigger;
- response or delay;
- whether the fault repeats;
- expected recovery decision.

Adapters translate one scenario into:

- `FakeApiScript` for headless E2E;
- fake-model `match/emit` steps for HTTP;
- scripted-turn outcomes for live launch;
- worktree/git fault behavior for persisted E2E.

Raw SSE helpers remain implementation details of the headless and fake-provider adapters.

## Failure matrix

Every row needs at least one focused test. Rows marked **E2E** also need a scenario through the highest practical layer.

### Planning and board initialization

- [ ] Invalid or missing plan path fails clearly.
- [ ] Empty task list reaches a defined terminal state.
- [ ] Duplicate task IDs are rejected.
- [ ] Unknown dependencies are rejected.
- [ ] Self-dependencies and dependency cycles are surfaced, not silently skipped.
- [ ] Invalid wave references are rejected or normalized.
- [ ] Board initialization interrupted before persistence is idempotent.
- [ ] Repeated initialization does not duplicate chats, tasks, or log events.

### Scheduling and concurrency

- [ ] Ready tasks launch once.
- [ ] Dependency-blocked tasks never launch.
- [ ] Prior-wave barrier behavior is explicit until DAG-only scheduling lands.
- [ ] Sequential mode never exceeds one slot.
- [ ] AFK respects board, global, and OOM concurrency caps. **E2E**
- [ ] Launch reservations prevent same-tick oversubscription. **E2E**
- [ ] Testing and fixer phases consume the intended slots. **E2E**
- [ ] Pipeline holds consume and release slots. **E2E**
- [ ] Hold expiry is observable and converges.
- [ ] Queue order is deterministic.
- [ ] Lost in-memory queue reconstructs after reload. **E2E**
- [ ] Two AFK boards cannot corrupt each other's queues, slots, logs, or worktrees.

### Model and transport

- [ ] Provider unavailable before request.
- [ ] Generation POST returns 4xx, 5xx, malformed JSON, or times out.
- [ ] Stream disconnects before first token.
- [ ] Stream disconnects during prose.
- [ ] Stream disconnects during tool name or arguments.
- [ ] Duplicate, reordered, glued, and delayed SSE events.
- [ ] Empty completion and missing finish reason.
- [ ] Context overflow from supported provider message variants.
- [ ] Max-duration and idle watchdog termination.
- [ ] Provider fallback before first byte.
- [ ] Failure after partial file mutations preserves transcript and work. **E2E**

### Tool loop and permissions

- [ ] Malformed tool arguments.
- [ ] Unknown tool.
- [ ] Role-forbidden tool.
- [ ] Tool permission is `ask` during AFK: fail fast without opening UI. **E2E**
- [ ] `ask_question` and mode-switch tools are unavailable in AFK. **E2E**
- [ ] Tool returns structured error, empty result, oversized result, or timeout.
- [ ] Duplicate mutating calls are bounded.
- [ ] Maximum tool rounds transition through explicit recovery.
- [ ] Tool success followed by generation failure remains recoverable.

### Agent-to-board contracts

- [ ] Builder pass, fail, environment-blocked, and needs-information outcomes.
- [ ] Missing builder report nudges once per persisted budget, then terminates.
- [ ] Tester pass and fail use structured reports.
- [ ] Conflicting outcomes follow one documented rule.
- [ ] Wrong task ID cannot complete a sibling.
- [ ] Duplicate report is idempotent.
- [ ] Late report from a superseded lifecycle is ignored.
- [ ] Final integration uses the same total contract.
- [ ] Free-form prose cannot silently advance a task.

### Retry, self-heal, and quarantine

- [ ] Each failure category selects one recovery path.
- [ ] Build, test, environment, merge, nudge, stop, and self-heal caps are enforced.
- [ ] Counters survive reload or are reconstructed from durable events. **E2E**
- [ ] Repeated stall eventually reclassifies or terminates.
- [ ] User stop does not consume counters.
- [ ] System stop follows a bounded policy.
- [ ] Root quarantine cascades once to every transitive dependent.
- [ ] Requeue resets only the intended lifecycle state.
- [ ] Preserved dirty work receives a recoverable commit before quarantine. **E2E**

### Git, worktrees, and integration

- [ ] Worktree creation failure cannot silently fall back to unsafe shared mutation in AFK.
- [ ] Existing branch/path collision.
- [ ] Dirty integration worktree.
- [ ] Commit reports nothing to commit.
- [ ] Commit fails after modifications.
- [ ] Clean merge.
- [ ] Merge conflict.
- [ ] Merge command error without conflict.
- [ ] Integration verification fails after merge.
- [ ] Restore to pre-merge SHA fails.
- [ ] Interrupted merge with and without `MERGE_HEAD`.
- [ ] Fixer reports pass while verification remains false.
- [ ] Fixer stalls, fails, or exceeds context.
- [ ] Sibling merges wait for the active integration owner.
- [ ] Final test starts only after the merge queue and holds are empty.
- [ ] At least one persisted E2E uses real git and real worktrees for every item above.

### Persistence and crash recovery

Inject restart at each checkpoint:

- [ ] after board start, before first launch;
- [ ] after launch reservation, before chat creation;
- [ ] during builder generation;
- [ ] after mutations, before report;
- [ ] after report, before stream-end finalization;
- [ ] between build and test;
- [ ] during tester generation;
- [ ] after test pass, before integration enqueue;
- [ ] during merge;
- [ ] during fixer;
- [ ] after merge, before completion persistence;
- [ ] during final integration;
- [ ] after terminal state, before completion notification.

For every checkpoint assert:

- no duplicate launch or side effect;
- no lost work;
- counters are monotonic;
- task ownership is reconstructible;
- board converges or terminates within policy;
- logs remain parseable with a trailing partial line.

### Stop, pause, and resume

- [ ] User stop during each phase.
- [ ] System shutdown during each phase.
- [ ] OOM pause during each phase.
- [ ] Resume after each stop type.
- [ ] Repeated stop/start is idempotent.
- [ ] Stop while planner report is queued.
- [ ] Stop while merge queue waits.
- [ ] AFK activation from manual, auto, and sequential modes.
- [ ] Sequential → AFK preserves the intended concurrency default.

### Planner reports, completion, and notifications

- [ ] Concurrent task reports queue and drain in deterministic order.
- [ ] Planner unavailable does not block board convergence.
- [ ] Report dedupe survives reload.
- [ ] Completion fires once per lifecycle.
- [ ] Notification dedupe survives reload.
- [ ] All-quarantined board emits blocked completion and skips final test.
- [ ] Mixed complete/quarantined board follows a documented final-test policy.
- [ ] Wrap-up pending survives unavailable model and reload.
- [ ] Issues review transition is idempotent.

### Resource and soak behavior

- [ ] No leaked interval, timeout, subscription, launch reservation, queue row, or hold.
- [ ] No unbounded chat, run, log, or worktree growth across repeated stable-ID runs.
- [ ] 100 quick happy-path AFK iterations with zero invariant failures.
- [ ] 100 mixed recoverable-fault iterations with expected outcomes.
- [ ] Multi-board stress at configured concurrency.
- [ ] Randomized deterministic event sequences retain replay seeds.
- [ ] Failure artifacts remain below a defined size cap.

## Expanded invariants

Add durable events needed to check:

- phase start/end pairing;
- slot acquire/release balance;
- observed peak concurrency versus configured cap;
- hold acquire/release/expiry balance;
- exactly one active owner per task lifecycle;
- retry counters are monotonic and within caps;
- no task mutation during final integration;
- merge operations are totally ordered;
- every non-terminal task at process end has a recovery reason;
- board terminal event occurs once;
- completion notification and planner report occur at most once;
- AFK emits no user-interaction-required event.

The checker should return:

- violations;
- skipped checks and why;
- incomplete evidence;
- reconstructed final state;
- metrics used by acceptance gates.

A missing event must not be treated as a passing invariant.

## Board testing UI

Evolve Settings → Advanced → Board testing from a setup kit into a scenario runner.

### Run controls

- [ ] Scenario profile: happy, recoverable faults, terminal faults, restart matrix, git matrix, soak, custom JSON.
- [ ] Preset: quick, smoke, or generated DAG.
- [ ] Execution mode includes AFK.
- [ ] Stable IDs and clean-reset options.
- [ ] Iteration count, deterministic seed, timeout, and fail-fast policy.
- [ ] Prepare, Run once, Start soak, Stop.

### Live status

- [ ] Current runner phase and elapsed time.
- [ ] Board/task/final-test progress.
- [ ] Active slots and holds.
- [ ] Last fake-model request with role, task, phase, and occurrence.
- [ ] Last board event and time since progress.
- [ ] Current invariant status.
- [ ] Direct link to the seeded board and timeline.

### Results

- [ ] Per-iteration pass, expected blocked, unexpected blocked, timeout, or harness error.
- [ ] Automatic log validation with the preset task graph.
- [ ] Download/copy failure bundle.
- [ ] Replay failed iteration from scenario ID and seed.
- [ ] Clear distinction between known product gaps and runner failures.

### API additions

- [ ] Configure and inspect fake-model scenarios.
- [ ] Tail sanitized fake-model requests.
- [ ] Start/stop/query a scenario run.
- [ ] Tail board logs.
- [ ] Fetch iteration transcripts and artifacts.
- [ ] Cooperatively abort without leaving `autoRunning` or streams active.

Persist runner artifacts under:

```text
~/.minnow/logs/orchestrate-scenarios/<run-id>/
  manifest.json
  iterations.jsonl
  scenario.json
  board-log.jsonl
  fake-model-requests.jsonl
  final-state.json
```

Do not include secrets, full provider headers, or unrestricted file contents.

## Delivery phases

### Phase 0 — make the baseline trustworthy

- [ ] Fix the five known-red recovery tests.
- [ ] Remove the fixer recovery timing flake with a virtual clock/event drain.
- [ ] Fail CI on unexpected board-test failures.
- [ ] Record the current pass count and runtime from CI rather than hard-coding it in docs.
- [ ] Add one complete AFK happy-path headless E2E.
- [ ] Add one complete AFK live-launch E2E with slot assertions.

**Exit:** `npm run test:board` is green and repeatable for 20 consecutive local runs.

### Phase 1 — unify scenarios and artifacts

- [ ] Define `BoardScenario`, semantic faults, expected outcomes, and adapters.
- [ ] Move quirk metadata into the shared catalog.
- [ ] Adapt headless E2E and fake-model HTTP to the same scenarios.
- [ ] Add deterministic seeds and replay commands.
- [ ] Standardize failure artifact output.

**Exit:** one scenario runs unchanged through headless and fake-provider adapters.

### Phase 2 — complete observability and invariants

- [ ] Add slot, hold, phase, owner, retry, and interaction-required events.
- [ ] Expand `checkBoardLog`.
- [ ] Remove E2E invariant skips by fixing event completeness.
- [ ] Auto-derive validation options from seed presets.
- [ ] Add log/request-tail APIs.

**Exit:** a complete run can be audited without reading in-memory state.

### Phase 3 — persisted server and real-git E2E

- [ ] Create isolated `MINNOW_HOME` and temporary git repository fixtures.
- [ ] Start the real server and fake provider on ephemeral ports.
- [ ] Drive AFK through persisted sessions.
- [ ] Add real worktree clean, conflict, verify-fail, restore, and cleanup scenarios.
- [ ] Assert disk state and JSONL invariants after process restart.

**Exit:** real git and persistence faults converge without fetch-router worktree mocks.

### Phase 4 — crash/reload matrix

- [ ] Add named restart checkpoints to the runner.
- [ ] Persist or reconstruct nudge, stall, queue, hold, and report-dedupe state.
- [ ] Run the checkpoint matrix against happy and recoverable-fault scenarios.
- [ ] Add OOM and shutdown variants.

**Exit:** every named checkpoint has a deterministic pass or documented terminal result.

### Phase 5 — Settings scenario runner

- [ ] Add scenario configuration and run controls.
- [ ] Poll live status with abortable requests.
- [ ] Show convergence, stalls, invariant failures, and request matching.
- [ ] Add repeat/soak mode and replay.
- [ ] Add artifact export and direct board/timeline links.

**Exit:** a developer can reproduce any catalog scenario without editing JSON or using a terminal.

### Phase 6 — release and soak gates

- [ ] Run fast unit/runtime tests on every PR.
- [ ] Run headless AFK scenarios on every PR.
- [ ] Run persisted real-git scenarios on Linux and Windows CI.
- [ ] Run restart matrix and 100-iteration soak nightly.
- [ ] Run Electron AFK smoke before release.
- [ ] Track convergence rate, unexpected quarantine rate, retry distribution, timeout rate, and median recovery rounds.

**Exit:** AFK meets the acceptance gate below for the release candidate.

## AFK acceptance gate

Do not label AFK hands-off until:

- all board tests are green;
- zero unexpected failures occur in 20 consecutive complete suite runs;
- happy-path soak completes 100/100 boards;
- recoverable-fault soak reaches the expected result 100/100 times;
- restart matrix passes at every checkpoint;
- real-git matrix passes on Linux and Windows;
- no run exceeds retry or concurrency caps;
- no run leaks runtime resources;
- no AFK run requests user interaction;
- every intentional terminal failure preserves work and emits a replayable artifact;
- Electron smoke proves the visible board reaches the same terminal state as its log.

Flaky retries in CI do not satisfy this gate. A retry may be part of the product scenario, but the test runner itself must be deterministic.

## Architectural dependencies

Testing alone will expose but not remove the largest fragility sources:

- free-form outcome parsing;
- task state spread across status plus many flags and in-memory maps;
- a separate merge-fixer lifecycle;
- overlapping wave and dependency gates.

The reliability program should align with the model-rethink sequence:

1. make builder, tester, fixer, and final reports mandatory and total;
2. introduce a pure task reducer and effect interpreter;
3. evaluate integration-by-owning-agent rerun against the merge-fixer;
4. reduce waves to presentation after DAG scheduling is authoritative.

The test scenario catalog should target semantic events so it survives these internal changes.

## Decisions to confirm before implementation

Recommended defaults are included so work can proceed without blocking.

- **AFK terminal policy:** Is quarantining after bounded recovery acceptable, or must the planner automatically re-plan?  
  **Recommended:** bounded quarantine is acceptable for the first gate; add re-plan as a separate scenario and policy.
- **Real model coverage:** Should release qualification include one local model?  
  **Recommended:** keep deterministic fake-provider tests as the gate; run local-model compatibility as non-blocking qualification.
- **Integration strategy:** Continue investing in merge-fixer coverage while integration-by-rerun is evaluated?  
  **Recommended:** cover the current engine fully, but keep scenario expectations strategy-neutral.
- **CI duration:** Which matrices run on PR, nightly, and release?  
  **Recommended:** PR gets unit, live launch, and headless; nightly gets persisted git, restart, and soak; release adds Electron.
- **Platform gate:** Is macOS required in addition to Linux and Windows?  
  **Recommended:** require Linux and Windows for worktree behavior; add macOS when a reliable runner is available.
- **Settings runner exposure:** Developer-only or user-visible Advanced setting?  
  **Recommended:** keep it in Advanced and gate destructive reset controls behind explicit test-workspace confirmation.

## Implementation todo summary

- [ ] Stabilize and green the current suite.
- [ ] Add first-class AFK E2E coverage.
- [ ] Create one semantic scenario catalog.
- [ ] Expand durable events and invariants.
- [ ] Add persisted server and real-git harnesses.
- [ ] Add deterministic crash/reload checkpoints.
- [ ] Build the Settings scenario runner.
- [ ] Add soak, platform, and release gates.
- [ ] Refactor product state/contracts in parallel with the reliability findings.
- [ ] Keep [`documentation/context.md`](../context.md) and the testing guide current as each phase lands.
