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

## 3. Phases (each independently shippable + reversible behind `MINNOW_SERVER_ENGINE` flag)

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
- **Driver lease**: engine tracks `boardDriverId` + heartbeat (`POST /api/session/lease`). Only the
  lease-holder runs `bootOrchestrateBoardResume` / `ensureAutoDriveSubscription`. Non-holders render
  the board **read-only** ("driven on another device"). Guard points:
  `src/chat/orchestrate/board-boot-resume.ts`, `resumeBoardExecutionAfterReload`,
  `startBoardAutoRun`, `autoDelegateNext`.

Deliverable: multiple devices stay visually in sync; exactly one drives. No logic moved.
Tests: `test/engine/session-phase0.test.mjs`.

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
- **Flag** `MINNOW_SERVER_ENGINE` (default **off**): composer/main-chat send uses
  commands; renderer does **not** call `runChatTurn` for main chat. Flag off ⇒
  `loop.ts` unchanged. Board stays renderer + lease.
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

### Phase 2 — Move the board scheduler into the engine
- Port `orchestrate-board-store.ts` (pure) and `orchestrate-board-actions.ts` into the engine.
  Replace the one `document.getElementById('modelSelect')` read with a value carried on
  planner/board state (set via a command when the user changes the top-bar model).
- Re-home the event bus: `subscribeChatStreamEnd` / `src/chat/streaming-state.ts` becomes an
  **in-process engine event** — the chat loop and the board both live in the engine, so stream-end
  is a direct callback, not a DOM bus. Re-home heartbeat/stall supervision timers
  (`agents/controller/wrapper.ts`) into the engine.
- Board commands via the command API: `board_init`, `board_start`, `board_stop`, `start_task`,
  `requeue`, `set_autonomy`, `run_final_test`, recovery actions (MIN-222).
- Retire renderer `board-boot-resume.ts`, `ensureAutoDriveSubscription`,
  `resumeBoardExecutionAfterReload`; the engine resumes boards on **server** boot.

### Phase 3 — Move the sub-agent controller into the engine
- Relocate `src/agents/controller/*` to run in the engine process (already Node-compatible;
  disk persistence + boot reconcile exist in `controller/persistence.ts`). De-DOM `registry.ts`
  and `wrapper.ts` (a few `emitBoardChange` UI pokes → engine events).
- Sub-agent live status flows to clients over the state SSE.

### Phase 4 — Retire renderer driving + cleanup
- Renderer becomes read-model + commands throughout; remove optimistic mutate-then-PUT for
  chat/board state (settings-only writes may remain as commands).
- Remove the driver lease (engine is sole driver by construction).
- Flip `MINNOW_SERVER_ENGINE` default-on; delete legacy renderer driving paths.

---

## 4. New surface area

### Endpoints
- `POST /api/session/commands` — `{ type, …payload }`; `202` + `{ rev }`.
- `GET  /api/session/stream` — SSE: `event: snapshot` then `event: patch` (JSON diff) with `id: <rev>`.
  Supports `Last-Event-ID` / `?sinceRev=` for replay-or-resnapshot.
- `POST /api/session/lease` — claim/renew driver lease (Phase 0 only; removed in Phase 4).
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
- Ported into engine later: `orchestrate-board-store.ts`, `orchestrate-board-actions.ts`,
  `agents/controller/*`.

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

- Reuse `test/orchestrate/board-flow-e2e.test.mts` (`driveBoardToConvergence`) against the **engine**
  module — logic is ported, not rewritten, so the harness drives the same functions.
- New: engine command dispatch tests; SSE snapshot/patch/replay (`sinceRev`) tests; version-guard 409
  tests; driver-lease exclusivity tests (Phase 0).
- Keep `test/headless/*` green as the loop generalizes.
- Multi-client integration test: two SSE subscribers + concurrent commands converge to one `rev`.

---

## 8. Recommended sequencing

Ship **Phase 0 first** — it delivers correct multi-device (no divergence, no double-run) with ~2
core files + a lease, fully reversible, and unblocks daily use while Phases 1–4 land the clean
server-owned architecture. Phases 1–4 are each shippable behind `MINNOW_SERVER_ENGINE`.
