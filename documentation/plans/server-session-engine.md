# Server Session Engine — Multi-Device Migration Plan

Move the **chat tool-loop** and **orchestrator board scheduler** off the renderer and into
a server-owned **Session Engine** so Minnow can be driven consistently from multiple devices
(single-user, many devices). Fixes the multi-device "second board, out of sync" bug by
construction: one process owns state and drives lifecycle; clients are thin views.

Target model: **single user, many devices** (desktop + phone + laptop hitting one local/home
Minnow server). No per-user isolation; a shared bearer token guards the new endpoints.

---

## 1. Current architecture (what's already server-side)

| Concern | Runs today | Reference |
|---|---|---|
| Model generation | **Server** — durable, replayable, multi-subscriber | `server/generations/store.js` (`Set<ServerResponse>` subscribers, byte-buffer replay), `src/api/generations.ts` |
| Tool side-effects | **Server** | `executeTool` → `POST /api/tools` (`src/tools/client.ts:719`) |
| Session persistence | **Server** | `GET/PUT/PATCH /api/config/sessions` → `sessions-repo.js` (SQLite seam; summaries/history/search routes). Optimistic `rev` / `If-Match` is **this** plan — not the JSON→SQLite migration. |
| DOM-less chat loop | **Exists** | `src/headless/runner.ts` ("generations + server tools, no DOM") |
| Hosting | Standalone Node (`server.js`, `npm start`); Vite in dev; Electron wraps it | `package.json` scripts |

What is still renderer-owned (the **driver surface**):

1. Main-chat tool-loop — `src/tools/loop.ts`
2. Board scheduler — `src/state/orchestrate-board-actions.ts`, `src/state/orchestrate-board-store.ts`
3. Sub-agent controller registry — `src/agents/controller/*`
4. In-memory authoritative `SessionState` — `src/state/sessions.ts`

DOM coupling in the driver is trivial: board-store **0** refs, board-actions **1** (`modelSelect`),
loop.ts **7** (all config-input reads: model/temp/maxTokens/systemPrompt). The headless runner
already resolves these from config instead of the DOM.

Mutation surface: **173** `scheduleSaveSessions`/`saveSessionsNow` sites across **53** files
(`ui/` 24, `chat/` 13, `state/` 7, other 9). This is broad but is **UI-triggered optimistic
writes** — it does **not** need to be rewritten into typed commands for multi-device (see Phase 0).

---

## 2. Target architecture

```
Device A ─┐                              ┌── SSE /api/session/stream (state diffs) ──┐
Device B ─┼── POST /api/session/commands ┤        Session Engine (in server.js)       │
Device C ─┘        (typed commands)      │  • owns authoritative SessionState         │
                                         │  • runs chat tool-loops                    │
   thin views: render + input            │  • runs board scheduler + stream-end bus   │
                                         │  • owns sub-agent controller registry      │
                                         │  • debounced flush → ~/.minnow             │
                                         └── reuses /api/generations, /api/tools ──────┘
```

- **Session Engine** (`server/engine/session-engine.js`, new): authoritative in-memory
  `SessionState`; command dispatcher; chat loop; board scheduler; sub-agent registry; event bus.
- **Command API** (`POST /api/session/commands`, new): typed commands, returns immediately.
- **State SSE** (`GET /api/session/stream`, new): snapshot + monotonic `rev`, then diffs.
  Reuses the subscriber-set + per-subscriber write-queue/drain pattern from `generations/store.js`.
- **Thin client**: renderer `sessionState` becomes a **read model** hydrated from the SSE stream;
  local mutations become command dispatches; renderer driving code is retired.

### Running `.ts` driver modules server-side
The driver modules are TS in `src/`. Precedent: `headless/runner.ts` already runs server-side via
`tsx`. Options: (a) import driver modules into the engine via `tsx` (as headless does), or
(b) compile them. Choose **(a) tsx import** to keep one source of truth and share `src/types.ts`.

---

## 3. Phases (shipped behind `MINNOW_SERVER_ENGINE`; Phase 4 flips default-on)

### Phase 0 — State sync + single-driver lease (stopgap) ✅ Done (MIN-357)

Shipped on `henri/min-357-phase-0-state-sync-single-driver-lease-stopgap` (`66856843`), then
**rebased onto SQLite sessions** for MIN-354 (this branch). Goal: kill passive divergence and
active double-run **without moving logic**.

- **Broadcast**: after successful sessions **PUT** (`writeWholeSessionState` / JSON write) and
  **PATCH** (`patchSessionState`), bump a monotonic `rev` and fan out the full state to
  `/api/session/stream` subscribers (`server/session/publish.js`).
- **State SSE endpoint**: `GET /api/session/stream` (snapshot + `rev`, then full-state `patch` events).
- **Version guard**: `PUT` and `PATCH` `/api/config/sessions` accept `If-Match: <rev>` and/or
  body `expectedRev` / `baseRev` (not schema `baseVersion`); reject stale writes **409** +
  `X-Session-Rev` → client re-pulls / retries once.
- **Client reconcile**: subscribe to the stream; when a newer `rev` arrives and the client is **not**
  actively streaming/driving, replace `sessionState` and re-render. `src/state/sessions.ts` +
  `src/state/session-sync.ts`.
- **Driver lease (stopgap, later removed)**: Phase 0 temporarily tracked `boardDriverId` +
  heartbeat via `POST /api/session/lease`. Only the lease-holder ran
  `bootOrchestrateBoardResume` / `ensureAutoDriveSubscription`; non-holders rendered the board
  read-only. Guard points lived in `board-boot-resume.ts`, `resumeBoardExecutionAfterReload`,
  `startBoardAutoRun`, `autoDelegateNext`. **Removed in Phase 4** — the Session Engine is the
  sole driver; `/api/session/lease` returns `410 LEASE_REMOVED`.

Deliverable (at Phase 0 ship): multiple devices stayed visually in sync; exactly one drove.
No logic moved yet. Tests: `test/engine/session-phase0.test.mjs` (now asserts lease removal).

### Phase 1 — Engine skeleton + main-chat sends ✅ Done (MIN-359)

Shipped on this branch (`henri/min-354-server-session-engine`). Lives under
`server/session/` (with Phase 0) to avoid colliding with vector `server/engine/*`.

- **Engine core**: [`server/session/engine.js`](../../server/session/engine.js) loads
  SessionState at boot (sessions-repo), owns it in memory, `applyCommand(cmd)`,
  persists + publishes via `notifySessionStateWritten` (Phase 0 SSE).
- **Commands**: `POST /api/session/commands` → 202 `{ rev }` for `send_message`,
  `stop_generation`, `steer_message`, `enqueue_message`. Flag probe:
  `GET /api/session/engine` → `{ enabled }`.
- **Main-chat loop**: [`src/session-engine/main-chat-loop.ts`](../../src/session-engine/main-chat-loop.ts)
  (tsx-loaded) generalizes headless runner + steer/queue/mode-switch seams.
  Tokens via `/api/generations`; committed history via SSE.
- **Flag** `MINNOW_SERVER_ENGINE` (later default-on in Phase 4): composer/main-chat
  send uses commands; renderer does **not** call `runChatTurn` for main chat.
  At Phase 1 ship time flag was default **off**; Board stayed renderer-driven (lease
  stopgap still in place until Phase 4).
- **Client**: [`src/state/session-commands.ts`](../../src/state/session-commands.ts),
  [`src/state/server-engine-flag.ts`](../../src/state/server-engine-flag.ts),
  [`src/chat/engine-stream-mirror.ts`](../../src/chat/engine-stream-mirror.ts).
- **Ported**: steering (full), message queue (full), mode tools as state mutations
  (`set_chat_mode` / `create_chat_with_mode` / `propose_mode_switch` → `pendingModeId`),
  goal post-turn auto-continue seam (simplified; not full eval-agent).
- **Gaps vs loop.ts**: attachments/VLM, archive/context budget, thinking budget,
  ask_question modal, full goal evaluator, Reef widget.
- **Tests**: `test/engine/session-phase1.test.mjs`,
  `test/session-engine/loop-helpers.test.mts`.

### Phase 2 — Move the board scheduler into the engine ✅ Done (MIN-360)

Shipped on this branch (`henri/min-354-server-session-engine`) behind `MINNOW_SERVER_ENGINE`
(default **off** at Phase 2 ship time; flipped default-on in Phase 4).

- **Board host**: [`src/session-engine/board-host.ts`](../../src/session-engine/board-host.ts)
  aliases engine SessionState into `sessions.ts`, installs the engine turn runner, and
  resumes `autoRunning` boards on **server** boot (`server/session/board-loader.js` via tsx).
- **Stream-end bus**: [`src/session-engine/stream-bus.ts`](../../src/session-engine/stream-bus.ts)
  — in-process; [`streaming-state.ts`](../../src/chat/streaming-state.ts) re-exports for UI.
  Board task turns await the Phase 1 loop then `notifyChatStreamEnded` (no DOM bus).
- **Model binding**: board `preferredModelId` / `preferredProviderId` + planner chat fields;
  `set_model` command; DOM `#modelSelect` only as legacy renderer fallback when preferred unset.
- **Commands**: `board_init`, `board_start`, `board_stop`, `board_start_task`,
  `board_requeue_task`, `board_set_autonomy`, `board_run_final_test`, `board_recover_task`
  (restart / continue / move_to_new_chat / reconcile_merge), `set_model`.
- **Flag on**: renderer skips `bootOrchestrateBoardResume` / board-driver gate
  ([`board-driver-gate.ts`](../../src/state/board-driver-gate.ts)); UI dispatches via
  [`board-command-bridge.ts`](../../src/state/board-command-bridge.ts).
  Engine main-chat loop re-adds `board_*` / `delegate_tasks` tool defs and executes them
  in-process via `executeBoardTool` + sync session rebind (kickoff `board_init` works).
- **Emergency opt-out** (`MINNOW_SERVER_ENGINE=0`): renderer board drive restored.
  Opt-out does **not** revive the Phase 0 lease (removed in Phase 4).
- **Gaps closed in Phase 3**: sub-agent controller registry moved to engine (see below).
  Remaining: concurrent `mutateEngineState` clone vs in-place board mutations can race
  mid-turn (publishLive + rebind mitigate); engine boot resume does not apply Electron
  OOM pause throttle (renderer-only marker).
- **Tests**: `test/engine/session-phase2.test.mjs` (run with css stub + tsx, as in
  `tsx-loader-mocks`); existing `test/orchestrate/board-flow-e2e.test.mts` still
  targets board-actions directly (same modules the engine hosts).
- **Process hooks**: `npm start` / `electron:dev` use
  `--import ./server/session/engine-tsx-hooks.mjs --import tsx` so board/main-chat
  `.ts` modules load under Node without setting `MINNOW_TEST`.

### Phase 3 — Move the sub-agent controller into the engine ✅ Done (MIN-361)

Shipped on this branch (`henri/min-354-server-session-engine`) behind `MINNOW_SERVER_ENGINE`
(default **off** at Phase 3 ship time; flipped default-on in Phase 4).

- **Controller host**: [`src/session-engine/controller-host.ts`](../../src/session-engine/controller-host.ts)
  activates at **server** boot (`server/session/controller-loader.js`) — runs
  `initControllerPersistence` + `startWatchdog` once per process (not per renderer).
  Board host is activated first so `syncBoardTask*` / reports share the engine SessionState alias.
- **De-DOM**: `wrapper.ts` visibility freeze is browser-only (`typeof document` guard; no tab-hide
  stalls in Node). `registry.ts` was already DOM-free. `report.ts` already no-ops UI render via
  `isDomAvailable()`. Live status no longer depends on renderer-local `emitSubAgentRunUpdated` alone.
- **Live SSE slice**: engine rebuilds `SessionState.liveSubAgentRuns` (compact snapshots) on registry
  updates ([`live-publish.ts`](../../src/agents/controller/live-publish.ts)) and soft-publishes via
  Phase 0 `publishLiveEngineState`. Ephemeral — stripped from client PUTs / durable validate path;
  preserved across engine hard writes.
- **Commands**: `spawn_sub_agent`, `cancel_sub_agent` on `POST /api/session/commands`
  ([`controller-commands.ts`](../../src/session-engine/controller-commands.ts)).
- **Main-chat loop**: in-process `spawn_sub_agent` / `cancel_sub_agent` / `list_sub_agents` /
  `get_sub_agent_status` (same pattern as board tools).
- **Client**: when flag on, `getSubAgentRun` / `listActiveSubAgentRuns` read the SSE live slice;
  spawn/cancel proxy to commands; `session-sync` mirrors remote live rows into
  `subscribeSubAgentRuns` ([`client-live-mirror.ts`](../../src/agents/controller/client-live-mirror.ts)).
- **Flag off**: unchanged renderer controller auto-boot + local registry.
- **Tests**: `test/engine/session-phase3.test.mjs`, `test/agents/controller-host-gate.test.mts`;
  existing `test/agents/controller-*.test.mts` + `test/sub-agents/**` keep `MINNOW_TEST=1` auto-boot.

### Phase 4 — Retire renderer driving + cleanup ✅ Done (MIN-362)

Shipped on this branch (`henri/min-354-server-session-engine`).

- Renderer is a **read-model + command dispatcher** for chat/board/sub-agent driving
  (composer → `POST /api/session/commands`; board UI → `board-command-bridge`;
  spawn/cancel → controller commands). Settings / non-driver session writes may still
  PATCH/PUT `/api/config/sessions` (not all 173 `scheduleSaveSessions` sites rewritten).
- **Driver lease deleted**: `server/session/lease.js` gone; `/api/session/lease` returns
  `410 LEASE_REMOVED`; client heartbeat + remote-driver banner removed.
- **`MINNOW_SERVER_ENGINE` default ON** (`server/session/flag.js`). Fresh `npm start`
  boots the engine with no env var. Emergency opt-out: `MINNOW_SERVER_ENGINE=0|false|off|no`
  restores legacy renderer driving (thin dual path kept for one release cycle).
- HTML inject + `GET /api/session/engine` reflect default-on.
- Tests: `test/engine/session-phase0.test.mjs` (lease-removed), phase1–3 updated;
  `test/agents/controller-host-gate.test.mts` covers default-on / opt-out.

---

## 4. New surface area

### Endpoints
- `POST /api/session/commands` — `{ type, …payload }`; `202` + `{ rev }`.
- `GET  /api/session/stream` — SSE: `event: snapshot` then `event: patch` (JSON diff) with `id: <rev>`.
  Supports `Last-Event-ID` / `?sinceRev=` for replay-or-resnapshot.
- ~~`POST /api/session/lease`~~ — removed in Phase 4 (`410 LEASE_REMOVED`).
- `PUT /api/config/sessions` — add `If-Match: <rev>` optimistic concurrency (Phase 0).
- `PATCH /api/config/sessions` — same `If-Match` / `expectedRev` / `baseRev` guard (Phase 0; SQLite adaptation).

### Commands (initial set)
`send_message`, `stop_generation`, `steer_message`, `rename_chat`, `delete_chat`,
`set_active_chat`, `set_view_mode`, `set_model`, `board_init`, `board_start`, `board_stop`,
`board_start_task`, `board_requeue_task`, `board_set_autonomy`, `board_run_final_test`,
`board_recover_task`.

### New/changed modules
- `server/session/engine.js` (Phase 1) — engine core (not `server/engine/`; vector lives there).
- `server/session/commands.js` (Phase 1) — command handlers.
- `server/session/loop-loader.js` (Phase 1) — tsx-load main-chat loop.
- `src/session-engine/main-chat-loop.ts` + `engine-loop-helpers.ts` (Phase 1).
- `src/state/session-sync.ts` (Phase 0) — client SSE subscribe + reconcile.
- `src/state/session-commands.ts` (Phase 1) — client command dispatch helpers.
- `src/state/server-engine-flag.ts` + `src/chat/engine-stream-mirror.ts` (Phase 1).
- Phase 2/3 ported: board store/actions via board-host; `agents/controller/*` via
  controller-host + live-publish SSE slice.

---

## 5. Cross-cutting concerns

- **Auth**: shared bearer token (`MINNOW_TOKEN` env) required on `/api/session/*`. Endpoints are now
  reachable from other devices; bind to LAN interface. Single-user ⇒ no per-user isolation.
- **Reconnect/replay**: SSE carries `rev`; client resumes with `sinceRev`; engine replays diffs or
  resnapshots. Mirrors `/api/generations` replay.
- **Backpressure**: reuse per-subscriber write-queue + `drain` handling from `generations/store.js`.
- **Persistence**: engine debounces flush to `~/.minnow/sessions/state.json`; boot loads + reconciles
  (controller run reconcile already exists).
- **Electron/offline**: engine runs in-process in `server.js`, which Electron already spawns —
  identical single-device behavior, now authoritative.
- **Generation ↔ history**: tokens keep flowing over `/api/generations` (unchanged); the engine emits
  the **committed** assistant/tool history over the state SSE once a turn settles.

---

## 6. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Merging `loop.ts` (steering, queue, goal, mode-switch, attachments) with headless runner | Medium | Do it behind the flag with both paths live; port feature-by-feature with parity tests |
| Client-only tools (`set_chat_mode`, `create_chat_with_mode`, `propose_mode_switch`) mutate DOM/state | Medium | Convert to engine state mutations + a UI-hint event on the SSE |
| Stream-end/heartbeat re-homing (`streaming-state.ts`, `controller/wrapper.ts`) | Medium | These become in-process engine events once loop+board co-locate; covered by board e2e harness |
| SSE reconnect/replay correctness | Medium | Reuse generations replay semantics; add integration tests for `sinceRev` |
| tsx-importing `src/*.ts` into `server.js` | Low | Precedent: headless runner already runs `.ts` via tsx |
| `SessionState` shape drift between engine + client | Low | Single shared type in `src/types.ts`; no schema fork |

---

## 7. Testing

- [x] Reuse `test/orchestrate/board-flow-e2e.test.mts` (`driveBoardToConvergence`) against the **engine**
  module — logic is ported, not rewritten, so the harness drives the same functions.
- [x] Engine command dispatch tests; SSE snapshot/patch/replay (`sinceRev`) tests; version-guard 409
  tests; Phase 4 lease-removed assertions (`410 LEASE_REMOVED`).
- [x] Boot smoke: `test/engine/engine-tsx-hooks.test.mjs` asserts
  `engine-tsx-hooks.mjs` self-registers on `--import` and resolves a dummy `.css` (live boot
  failed when hooks exported `resolve`/`load` without `register`).
- [x] Keep `test/headless/*` green as the loop generalizes.
- [ ] Multi-client integration test: two SSE subscribers + concurrent commands converge to one `rev`.

---

## 8. Recommended sequencing

Phases 0–4 are complete on this branch. Production default is engine-on; use
`MINNOW_SERVER_ENGINE=0` only as an emergency rollback. Full deletion of the opt-out dual
path can wait one release cycle after Phase 4 stabilizes.
