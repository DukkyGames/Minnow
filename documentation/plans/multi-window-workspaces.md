# Multi-window and workspace tabs

## Context

Minnow is single-workspace by construction. One folder path lives in a module-level
string — [`server/workspace/root.js:26`](server/workspace/root.js:26) — and 70 call
sites across 35 server files read it through `getWorkspaceRoot()`. Switching folders
is a *mutation* of that global, plus a hand-maintained 20-step teardown/rebuild in
[`applyWorkspaceSwitch`](src/ui/workspace-button.ts:61) on the client. There is one
`BrowserWindow` ([`electron/main.ts:95`](electron/main.ts:95)), one in-process HTTP
server ([`electron/server-host.ts:12`](electron/server-host.ts:12)), and one SPA.

The goal is to have **several workspaces open at once** — first as separate OS
windows, then as tabs within a window. Today that is impossible: two views would
race on `workspaceRoot`, and the moment one flips it, every in-flight agent bound to
the other root starts failing the path allowlist with
`workspaceRoot is not in the allowlist`.

Two facts shaped the design:

- **The renderer cannot host two workspaces.** 162 files import from
  `src/state/sessions`, ~63 of them reaching for the module-global `sessionState`
  directly ([`sessions.ts:138`](src/state/sessions.ts:138)), and
  [`src/os/instances.ts:134`](src/os/instances.ts:134) de-dupes app instances by
  `appId`. Making renderer state workspace-keyed is a multi-month rewrite of the
  whole SPA. So: **one full SPA renderer per open workspace.** Every renderer module
  global then becomes per-workspace for free.
- **The seam already exists on the server.**
  [`server/runtime/path-access.js`](server/runtime/path-access.js) already has an
  `AsyncLocalStorage` with `getEffectiveWorkspaceRoot()` and
  `runWithToolContext(fn, { workspaceRoot })`, used today by brain, dev-server,
  preview, research, and the tools middleware. The work is to widen that from
  "occasional override" to "every request carries its workspace".

Along the way this fixes a live bug: a scheduled job spawns the headless CLI with
`--workspace <path>` against the *same* running server
([`server/scheduler/runner.js:153`](server/scheduler/runner.js:153)), and
[`src/headless/preflight.ts:89`](src/headless/preflight.ts:89) issues
`PUT /api/workspace` — globally repointing the desktop UI's workspace, killing every
LSP server, and kicking a brain cascade out from under the user mid-session.

## Locked decisions

| Decision | Choice |
|---|---|
| Isolation | One SPA renderer per workspace (`BrowserWindow` now, `WebContentsView` per tab later) |
| Tab contents | One workspace per tab. The app rail (Code / Issues / Email / …) stays as-is *inside* a tab |
| Live budget | 4 hot renderers, LRU-sleep the rest — same policy and shape as [`PreviewInstanceRegistry`](electron/preview-instance-registry.ts) |
| Duplicate opens | A folder opens in exactly one view; opening it again focuses the existing one |
| Ship order | Server scoping → Electron multi-window → tabs. Single-window Minnow must behave identically at every step |

The duplicate-open rule is load-bearing, not just UX: `sessions.db` has a single
global `revision` counter ([`sessions-repo.js:38-61`](server/config/sessions-repo.js:38)),
so two views owning the same chat rows would 409-thrash. With the rule, no two views
ever own the same rows and blind PATCH-retry on 409 is safe.

---

## Phase 1 — Request-scoped workspace on the server

Ships with no UI change. Single-window Minnow behaves identically; every request
simply now says which folder it means.

### 1a. Carry the workspace on the wire

Three transports, three mechanisms, all with a single client-side choke point:

| Transport | Mechanism | Client choke point |
|---|---|---|
| `fetch` | `X-Minnow-Workspace` header | [`install-fetch-auth.ts:20`](src/api/install-fetch-auth.ts) — already monkey-patches `fetch` to add `X-Minnow-Token`; add one line |
| SSE / WebSocket | `?workspace=` query param (neither can set headers) | [`withSessionToken(url)`](src/api/session-token.ts:98) — already appends `?token=` for all ~13 `EventSource` sites and the PTY/STT/TTS sockets |
| Explicit body override | Existing `workspaceRoot` body field, unchanged | [`client.ts:780`](src/tools/client.ts:780) |

Precedence: explicit body `workspaceRoot` (a worktree or sandbox) wins, then the
header/query workspace, then the persisted global. The last fallback is what keeps the
LAN companion, the headless CLI, and any old client working unchanged.

The renderer's source of truth is a new `src/state/view-workspace.ts`:
`getViewWorkspacePath()` returns `window.minnow.viewContext.workspacePath` in Electron
and `''` elsewhere. `''` means "use the server's global", which is exactly today's
behaviour.

### 1b. The middleware

New `createWorkspaceScopeMiddleware()`, registered in
[`middlewares.js`](server/runtime/middlewares.js:82) immediately **after**
`createAuthMiddleware()` — authenticate first, then scope. Model it on
[`auth-middleware.js:41`](server/runtime/auth-middleware.js:41), which already parses
the URL and reads a value from "header or `?query=`". It resolves the workspace,
validates it against the registry (Phase 2), and runs the rest of the chain inside
`pathAccessStore.run({ workspaceRootOverride }, next)`.

`AsyncLocalStorage` propagates through `next()` because connect invokes the next layer
synchronously, and through every `await` inside the handler.

### 1c. Migrate the 70 call sites

`getEffectiveWorkspaceRoot()` ([`path-access.js:22`](server/runtime/path-access.js:22))
already does the right thing — it returns the ALS override when present. The mechanical
work is swapping `getWorkspaceRoot()` → `getEffectiveWorkspaceRoot()` across 35 files;
50 of the 70 sites sit in four directories — `worktree/` (17), `dev-server/` (14),
`workspace/` (11), `orchestrator/` (8).

To stop the bug being reintroduced, rename the raw accessor to something that reads as
wrong — `getPersistedGlobalWorkspaceRoot()` — so the short, obvious name is the correct
one. Every remaining caller of the raw accessor should be a deliberate, commented
exception (boot, config persistence, the fallback inside `getEffectiveWorkspaceRoot`
itself).

### 1d. The rule that will be gotten wrong

**ALS only covers work that finishes inside the request.** Boards, sub-agents, scheduler
jobs, dev servers, PTY sessions, and background shell runs all outlive it, so they must
carry their workspace on their own record and re-enter `runWithToolContext` when they
resume. Half of this already exists — boards stamp `workspacePath` on `board.created`
([`middleware.js:583`](server/orchestrator/middleware.js:583)) and scheduler jobs carry
`workspacePath` ([`scheduler/workspace.js:14`](server/scheduler/workspace.js:14)) — but
both still *fall back* to the global. The concrete offenders:

- [`effector-runner.js:315`](server/orchestrator/effector-runner.js:315) snapshots
  `getWorkspaceRoot()` into `fallbackCwd` at effector-creation time. Must read the
  board's own journaled `workspacePath`.
- [`terminal-runner.js:313,487`](server/terminal-runner.js:313) stamps
  `workspaceRoot: getWorkspaceRoot()` onto `activeRuns` at spawn.
- [`plugin-context.js:27`](server/tools/plugin-context.js:27) freezes `workspaceRoot`
  into every plugin handler.

### 1e. Sessions concurrency

The store has one global `revision`
([`sessions-repo.js:38-61`](server/config/sessions-repo.js:38)) and returns 409 on a
stale `baseRevision`. Because a folder opens in exactly one view, **no two views ever
own the same chat rows**, and PATCH bodies are whole objects for chats the client owns —
so on 409 the client can refresh `revision` and re-send the identical PATCH. No
read-modify-write, no merge, no schema change.

Two caveats:

- The global `activeId` scalar would ping-pong between views. Views should read and
  write the already-existing workspace-keyed `lastActiveChatIdByWorkspace` instead and
  stop writing `activeId` (or let only the focused window write it).
- **Do not** relax `writeWholeSessionState`'s upsert-only rule or the
  `pruneMissingChats` guard while touching this. That guard is what stopped the 2026-08
  history wipe, and a second concurrent writer is precisely the condition it defends
  against. Extend
  [`sessions-history-loss.test.js`](test/config/sessions-history-loss.test.js) with a
  two-writer case rather than adding a separate suite.

---

## Phase 2 — Open-workspace registry

Today the security boundary is "the one workspace":
[`isAllowedWorkspaceRoot`](server/chats-workspace/paths.js:62) admits
`getWorkspaceRoot()` plus the four `~/.minnow` sandboxes plus registered git worktrees.
A second real project folder is **rejected** — so nothing in Phase 1 works until this
changes.

Replace the single root with an in-memory `Set` of open workspace keys, owned by a new
`server/workspace/open-workspaces.js`:

- Entries are added when a view opens a folder and removed when the last view on it
  closes. Electron main is the authority (it owns the window/tab registry); the server
  exposes `POST /api/workspace/open` and `DELETE /api/workspace/open`.
- Not persisted — restart starts empty and windows re-register as they boot. Persisting
  it would let a stale entry widen the filesystem boundary after a crash.
- `isAllowedWorkspaceRoot` checks membership instead of equality. `validateAllowedWorkspaceRoot`
  ([`paths.js:104`](server/chats-workspace/paths.js:104)) and its ~10 call sites need no
  change.

`PUT /api/workspace` stops being a global mutation. It keeps writing
`workspace.path` as the *default for the next cold boot* and keeps touching the MRU
(`recentPaths`), but no longer repoints live work, no longer calls `shutdownAllLsp()`,
and no longer kicks a brain cascade — those become per-workspace concerns.

### Un-keying the colliding singletons

Ranked. The first three block two live workspaces; the rest degrade gracefully and can
follow.

| Must fix | Where | New key |
|---|---|---|
| LSP servers | [`connectionProcessKey`](server/lsp/manager.js:90) returns a bare `serverId` for the editor and index scopes — which is exactly why `setWorkspaceRoot` calls `shutdownAllLsp()` | Drop the `if (scope === LSP_SCOPE_AGENT)` guard so every scope gets the `${serverId}::${root}` key the agent scope already uses. One line; the hard part is auditing what else assumes one tsserver |
| Worktree allowlist cache | [`allowlist.js:15`](server/worktree/allowlist.js:15) — one 30s-TTL cache from `git worktree list` in the global root | keyed by repo root |
| Sandbox policy | [`policy.js:130`](server/terminal/sandbox/policy.js:130) — write-roots default to the global root | take the effective root |

| Can follow | Where | Degradation if deferred |
|---|---|---|
| LOC cache | [`loc.js:29`](server/workspace/loc.js:29) single slot | two workspaces thrash it; recomputes, stays correct |
| Brain cascade timers | [`cascade.js:45,48`](server/brain/code/cascade.js:45) not repo-keyed (though `cascadeInFlightByRepo` is) | one workspace's re-synthesis can starve another's |
| Orchestrator engines | [`engine.js:678`](server/orchestrator/engine.js:678) keyed `namespace\tboardId` | board ids are unique, so no collision today — but `disposeEngines()` is all-or-nothing |
| MCP registry | [`registry.js:27`](server/mcp/registry.js:27) spawns with `cwd: PROJECT_ROOT` | MCP servers run in whichever folder booted first |

Already correctly keyed, leave alone: dev-server manager (`byWorkspaceKey`), brain code
index DBs (`dbByWorkspaceKey`, LRU 8 — it already warms 4 MRU folders at once),
worktree paths (`repoKeyForWorkspace`), board workspace filtering, and the sessions
`chats.workspace_path` column.

---

## Phase 3 — Electron window registry

Turn the one `mainWindow` into N windows, each bound to a workspace. No tabs yet.

### 3a. The registry

New `electron/shell-window-registry.ts`, modelled on the tested
[`preview-instance-registry.ts`](electron/preview-instance-registry.ts): a
`Map<number /* win.id */, { workspacePath, lastFocusedAt }>` with
`register` / `unregister` / `findByWorkspace(key)` / `list()` / `mostRecentlyFocused()`.
Keys must match the server exactly — import `normalizeWorkspacePathKey` from
[`server/workspace/root.js`](server/workspace/root.js) via the existing
[`importServerModule`](electron/server-import.ts) rather than writing a third
normalizer (there are already two: server `normalizeWorkspacePathKey` and client
[`normalize-workspace-path.ts`](src/lib/normalize-workspace-path.ts)).

`createMainWindow()` ([`main.ts:455`](electron/main.ts:455)) becomes
`createShellWindow({ workspacePath })`. The workspace reaches the renderer through
`webPreferences.additionalArguments` (`--minnow-workspace=…`, `--minnow-view-id=…`),
read in [`preload.ts`](electron/preload.ts) from `process.argv` and exposed on the
existing bridge as `window.minnow.viewContext`. No new IPC round-trip, and it works
in dev and packaged alike.

### 3b. De-globalise the main process

Everything below currently targets `mainWindow` and must resolve a window instead.
Sender-scoped handlers ([`main.ts:208-233`](electron/main.ts:208)), the whole of
`preview-host.ts`, `wireShellWindowState` / `wireShellWindowVisibility`, and the
updater broadcast are **already correct** — leave them.

| Site | Fix |
|---|---|
| [`main.ts:292`](electron/main.ts:292) `SHELL_SET_ZOOM_PERCENT` | Ignores `event.sender` entirely and zooms `mainWindow`. Resolve the sender, then broadcast the new percent to the others (it stays an app-wide pref) |
| [`main.ts:262`](electron/main.ts:262), [`:441`](electron/main.ts:441) `TRAY_CLOSE_TO_TRAY_CHANGED` | Broadcast to all windows |
| [`main.ts:150`](electron/main.ts:150) `wirePowerWakeNotifications` | Broadcast |
| [`main.ts:394`](electron/main.ts:394) `focusMainWindow` | `focusWindow(target?)`, defaulting to most-recently-focused |
| [`main.ts:399-414`](electron/main.ts:399) `sendTrayCommand` / `queuedTrayCommands` / `rendererTrayReady` | Per-window `Map<number, { ready, queue }>`; tray commands go to the focused window |
| [`main.ts:416`](electron/main.ts:416) `requestExplicitQuit` | Close every window |
| [`main.ts:347`](electron/main.ts:347) `shutdownRuntime` | `pauseOrchestrateBoardsInRenderer` for every window, in parallel |
| [`main.ts:107`](electron/main.ts:107) `rendererCrashTimestamps` | Per-window budget, else one crashy window burns the others' reload allowance |

### 3c. Lifecycle

- **`window-state.ts`** grows from one blob to `{ version: 2, windows: [{ workspacePath, bounds, isMaximized }] }`. Reads v1 as a single unnamed entry. All writes go through one serialized queue — N windows each debouncing at 200ms would otherwise race the same file.
- **Boot** restores the previous window set (skipping folders that no longer exist), falling back to a single gate window.
- **`second-instance`** ([`main.ts:719`](electron/main.ts:719)) currently drops `argv`. Make `minnow <path>` focus that folder's window if open, else open a new one.
- **`activate` latent bug** ([`main.ts:737`](electron/main.ts:737)): `bootstrap()` memoizes `bootstrapPromise` and clears it only on failure, so after a real close on macOS `activate` resolves the cached promise and never recreates a window. Split `bootstrap()` (runtime init, once) from `openShellWindow()` (per window).

### 3d. The workspace gate

[`initApp`](src/main.ts:238) always awaits the folder picker on cold boot, even when a
path is persisted. A window that boots with `viewContext.workspacePath` already set
must skip it: resolve the boot gate immediately and `launchApp('code')`. The precedent
is already there — [`syncWorkspaceGateFromRoute`](src/os/workspace-gate.ts:197) does
exactly this for reloads via `hasWorkspaceGatePassedThisSession()`. A window opened with
no workspace (the "New window" case) still gets the gate, and picking there calls the
new `WINDOW_OPEN_WORKSPACE` path rather than a global PUT.

### 3e. New IPC and the duplicate-open rule

- `WINDOW_OPEN_WORKSPACE(path)` — open or focus. This is where "one folder, one view" is enforced.
- `WINDOW_LIST_WORKSPACES()` — so the recents list in [`welcome-page.ts`](src/ui/welcome-page.ts) can mark already-open folders and route their click to focus rather than switch.

### 3f. In-window switch becomes retarget + reload

Once a view owns its workspace, switching folders inside a window is "tell main this
view is now folder X, then reload the renderer". That deletes
[`applyWorkspaceSwitch`](src/ui/workspace-button.ts:61) — a hand-maintained ~20-step
teardown that already has three bug plans against it
(`workspace-switch-board-stop-hang.md`, `min-780-main-worktree-missing.md`, branch
`fix/resize-observer-loop-workspace-load`). Everything it rebuilds is persisted
per-workspace on disk (file panel, terminal tabs, chats, issues), so a ~2.5s reload
is strictly safer than the partial reset. Keep the running-board confirm from
[`workspace-switch-guard.ts`](src/ui/workspace-switch-guard.ts) — with per-view
workspaces it no longer has to stop the boards, only warn.

---

## Phase 4 — Workspace tabs

One `BrowserWindow` per window. Its **top-level web contents** loads a thin host
chrome page — tab strip, window controls, drag region, nothing else. Each tab is a
`WebContentsView` below it running the full SPA.

The split is forced, not stylistic: `-webkit-app-region: drag` does not work inside
child views, so the drag region has to live in the window's own web contents. That
also gives the tab strip a place to sit that does not compete with the SPA's
46px menubar ([`--os-menubar-h`](src/styles/minnowos-tokens.css)), which already
carries ~10 controls plus 92px of macOS traffic-light padding.

### What to reuse

| Need | Existing code |
|---|---|
| `windowId → id → state` registry with LRU eviction of non-visible entries | [`PreviewInstanceRegistry`](electron/preview-instance-registry.ts) — copy the shape for `WorkspaceTabRegistry`, cap 4 |
| Tab strip visuals | `.unified-tab*` in [`file-panel.css:203-372`](src/styles/file-panel.css) |
| Drag-reorder, drop indicator, middle-click close, context menu, Ctrl+W / Ctrl+Tab / arrows | [`unified-right-tabs.ts:115-141, 198-287, 481-532`](src/ui/unified-right-tabs.ts) — extract the kind-agnostic half; it is currently hardwired to `file:` / `preview:` prefixes |
| Tab store (`Map + tabOrder + activeId + Set<listener>`) | Duplicated verbatim in [`file-viewer-tab-store.ts`](src/ui/file-viewer-tab-store.ts) and [`preview-tab-store.ts`](src/ui/preview-tab-store.ts) — extract one generic `TabStore<T>` and put all three on it |
| Window controls, drag marking, darwin traffic-light handling | [`menubar-window-controls.ts`](src/os/menubar-window-controls.ts), [`window-control-buttons.ts`](src/os/window-control-buttons.ts) |

The chrome page is same-origin with the SPA, so it reads the persisted theme from
`localStorage` and links [`tokens.css`](src/styles/tokens.css) directly — no
theme-sync IPC.

### Sleeping tabs

Over 4 live views, evict the least-recently-used **hidden** tab: destroy its
`WebContentsView`, keep the strip entry, dim it, re-create on activate. Safe because
generations are backend-owned and resumable
([`generation-resume.ts`](src/chat/generation-resume.ts)) and V2 boards are owned by
the server engine. Never evict a tab whose workspace has a running board or in-flight
generation; if every candidate is busy, skip eviction — the same "skip when nothing
is evictable" rule `PreviewInstanceRegistry` already uses.

### Three things this breaks

- **The SPA's own window chrome.** When hosted in a tab, `initShellMenubarChrome`
  ([`menubar-window-controls.ts:29`](src/os/menubar-window-controls.ts)) must not mount
  min/max/close or claim a drag region. Gate on `window.minnow.viewContext.hosted`.
- **Preview guests.** [`preview-host.ts`](electron/preview-host.ts) keys guests by
  `windowId` and positions them in window coordinates from renderer-reported bounds.
  With the SPA inside a tab view, those bounds are offset by the chrome strip and must
  be clipped to the tab rect. The `instanceId` axis already exists
  (`DEFAULT_PREVIEW_INSTANCE_ID = 'workspace-preview'`) — namespace it per tab and add
  the offset in `relayoutInstanceEntry`. Budget real time for this; it is the most
  fiddly part of Phase 4.
- **Shell zoom.** [`hostZoomFactor`](electron/preview-host.ts:593) reads
  `win.webContents.getZoomFactor()`, and [`wireShellZoom(win, …)`](electron/main.ts:486)
  sets it on the window. Once the SPA lives in a child view, its zoom is on the *view's*
  web contents — the window reports `1` and preview bounds get mis-scaled at the default
  80% shell zoom. Zoom must be applied to, and read from, the active tab's view.

Dragging a tab out into its own window is a follow-on (4b), not part of the first cut.

---

## Picked up along the way

Three existing defects that this work either fixes for free or makes cheap to fix.
None is a reason to widen scope beyond them.

- **Headless CLI repoints the live UI.** [`putWorkspace`](src/headless/preflight.ts:89)
  issues a global `PUT /api/workspace` against the same running server that the desktop
  is using, and [`scheduler/runner.js:153`](server/scheduler/runner.js:153) triggers it on
  a schedule. Once requests carry their own workspace the CLI stops PUTting; delete the
  call rather than leaving it as a second way to move everyone's folder.
- **`/api/git` has no path allowlist.**
  [`resolveCwd`](server/git/git-ops.js:16) runs git in any `cwd` the caller supplies,
  unlike `/api/tools` and `/api/terminal` which go through
  `validateAllowedWorkspaceRoot`. The open-workspace registry from Phase 2 makes the
  check a one-liner; add it there. Today the auth gate is the only thing standing
  between a paired LAN companion and git in an arbitrary directory.
- **macOS `activate` cannot reopen a window** — the memoized `bootstrap()` described in
  3c. Independent of this feature, but the fix falls out of splitting bootstrap from
  window creation.

**Docs.** [`documentation/context.md`](documentation/context.md) is the file
contributors are told to update when architecture or storage changes; the "Minnow
Shell" section's *"There is one stage"* rule and the workspace/persistence tables all
become wrong at Phase 3. The plan itself should land as
`documentation/plans/multi-window-workspaces.md` in the repo's usual frontmatter shape
(`name` / `overview` / `isProject`, then Date / Goal / Todos / Why / Locked decisions).

## Verification

Each phase must leave single-window Minnow behaving identically.

**Automated** — follow the repo convention of extracting pure logic into a module with
a sibling test:

- `test/electron/shell-window-registry.test.mjs` — register/unregister, duplicate-path
  lookup, focus ordering, key normalization matching the server's.
- `test/electron/window-state.test.mjs` — v1 → v2 migration, multi-window round-trip,
  serialized writes.
- `test/workspace/workspace-scope-middleware.test.mjs` — header and query-param
  scoping, unknown-workspace rejection, fallback when absent.
- `test/workspace/open-workspace-registry.test.mjs` — allowlist admits open folders and
  only open folders.
- `test/config/sessions-multi-view.test.mjs` — two views on different workspaces
  PATCHing concurrently never drop rows. Extend
  [`sessions-history-loss.test.js`](test/config/sessions-history-loss.test.js) rather
  than writing a parallel suite.
- Full gates: `npm test` and `npx tsc --noEmit` (both are CI gates; note that test runs
  dirty `test/fixtures`, and a few suites already fail on clean `main`).

**Manual, in the real app** (`npm run desktop`, or the "Minnow Full-Stack" launch
config — Vite alone shows the pairing screen and never boots MinnowOS):

1. Open two windows on two different repos. In each: file tree, `grep`, a terminal
   `pwd`, and `git status` all resolve to that window's folder.
2. Run an agent turn in both simultaneously; neither writes into the other's tree.
3. Kill one window mid-turn; the other keeps streaming and the server stays up.
4. Open a folder already open elsewhere — the existing window focuses, no second view.
5. Restart; both windows come back on their folders.
6. Start a dev server and an LSP-backed edit in each window at once — check LSP
   diagnostics are per-folder, and that `npm run dev` in window A does not appear in
   window B's Dev Servers screen.
7. Boards: start one in each workspace, confirm `GET /api/boards` filtering still
   holds and neither board runs git against the other repo.
8. Phase 4 only: open 6 tabs, confirm the 2 oldest hidden ones sleep, that a sleeping
   tab with a running board is skipped, and that waking one restores its chat.
