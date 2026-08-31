# Orchestrator V2 — Browser driver reusability assessment

**Issue:** MIN-719 (P5-A) · **Date:** 2026-08-30 · **Status:** decided, implemented

This is the assessment MIN-719 requires *before* a new host is built. It names every
existing piece of browser machinery, classifies it **reuse / port / replace**, and
justifies the host choice on evidence.

---

## 1. What already exists

### 1.1 `server/cdp/` — not a CDP client

The directory name is a fossil. What survives in `server/cdp/` today is **policy and
paths**, with no protocol code at all:

| File | Lines | What it actually is |
|---|---|---|
| `server/cdp/allowlist.js` | 170 | Origin glob matching, ephemeral one-shot grants, `assertNavigationAllowed`. Pure. No browser. |
| `server/cdp/browser-config.js` | 113 | Reads `browser.{enabled,allowNavigate,allowedOriginPatterns}` out of `~/.minnow/config.json`, mtime-cached; appends approved patterns. |
| `server/cdp/paths.js` | 55 | `~/.minnow/screenshots/` writer + traversal-safe reader. |

The real protocol code was **deleted** in commit `86cc513f` *"Route browser_\* tools
through Electron preview (drop external CDP)"*. It is recoverable from git and it is
good:

| Deleted file | Lines | Assessment |
|---|---|---|
| `server/cdp/client.js` | 105 | Minimal CDP WebSocket client over `ws` (id/pending map, event handlers, 30 s per-command timeout). Ported from opencode-browser (MIT). |
| `server/cdp/targets.js` | 54 | `GET /json/list` target enumeration + proxy WS-URL rewriting. |
| `server/cdp/snapshot.js` | 133 | `Accessibility.getFullAXTree` → stable-uid tree + `renderTree` text format. |
| `server/cdp/snapshot-cache.js` | 35 | In-process snapshot cache keyed by browser URL + target. |
| `server/cdp/browser-tools.js` | 373 | The tool handlers (navigate/snapshot/click/fill/screenshot). |

Crucially, none of that code ever **launched** a browser. It connected to a
`browser_url` the user had already started with `--remote-debugging-port`. The whole
of P5-A's actual subject — process lifecycle, health, supervised kill, profile
isolation, absent-browser degradation — has never existed in this repo.

### 1.2 `server/preview/` — a static file server, not a browser

`middleware.js` / `document-html.js` / `mime-types.js` serve workspace files to the
in-app preview panel (`/api/preview/file/*`). Nothing here drives a browser. It is
**not relevant** to the driver beyond being a possible thing to point the driver at.

### 1.3 The middlewares

- `server/browser-screenshot-middleware.js` (101) — `POST/GET /api/browser/screenshot`, wrapping `cdp/paths.js`. Server-side already; the driver reuses `writeScreenshot()` directly rather than the HTTP hop.
- `server/browser-allowlist-middleware.js` (141) — `/api/browser/allowlist/{check,consume,approve}`, wrapping `cdp/allowlist.js` + `cdp/browser-config.js`. Server-side already; the driver calls the underlying modules in-process.

### 1.4 `src/tools/browser-*.ts` — renderer, Electron-bound

| File | Lines | What it is |
|---|---|---|
| `browser-preview-tools.ts` | 592 | **The actual browser automation today.** Drives an Electron `WebContentsView` through `window.minnow.preview` IPC. Hard-requires the desktop shell (`isMinnowElectronShell`, `isPreviewAutomationReady`) and errors out otherwise. |
| `browser-navigation-gate.ts` | 342 | Pre-flight `ask_question` approval card for out-of-allowlist URLs; `acquireUserPromptLock`, `blockAfkInteractionAttempt`. Interactive by construction. |
| `browser-preview-snapshot.ts` | 164 | A DOM-walking snapshot **script string** + tree renderer, written to mimic the deleted `server/cdp/snapshot.js` output because CDP's `Accessibility` domain is unavailable through the Electron IPC surface. |
| `browser-allowlist-match.ts` | 100 | A hand-maintained TypeScript **duplicate** of `server/cdp/allowlist.js`. |
| `browser-executor.ts` | 453 | Misleading name. Contains no browser automation — its own header says so. `get_datetime`, `calculate`, `web_search`, clipboard, appearance. |

---

## 2. Verdict per file

| Path | Verdict | Reason |
|---|---|---|
| `server/cdp/allowlist.js` | **reuse as-is** | Pure, already the single source of allowlist truth, already server-side. The driver imports `isNavigationAllowed` / `originFromUrl`. Not modified. |
| `server/cdp/browser-config.js` | **reuse as-is** | `loadBrowserConfig()` gives the driver `enabled` and `allowedOriginPatterns` with no new settings surface. A disabled setting becomes a capability report, not an error. |
| `server/cdp/paths.js` | **reuse as-is** | `writeScreenshot()` is exactly the evidence sink the driver needs, and it already resolves traversal-safe ids the existing `/api/browser/screenshot/:id` route can serve. |
| `server/cdp/client.js` (deleted) | **port** — restored + hardened | Restored from `86cc513f^` as `server/browser-driver/cdp-client.js`. Changes: lazy `import('ws')` so the module loads where `ws` is absent; per-call deadline is a parameter, not a 30 s constant; a socket close/error **rejects every pending call** (the original left them hanging forever — precisely the "hung browser hangs the engine" failure this issue exists to prevent); `attachedToTarget`-free, one socket per target. |
| `server/cdp/targets.js` (deleted) | **port** — folded in | `/json/list` + page selection are ~20 lines inside `session.js`; the proxy WS-rewriting branch is dropped because the driver only ever talks to a browser it launched on loopback. |
| `server/cdp/snapshot.js` (deleted) | **port** — restored near-verbatim | `server/browser-driver/snapshot.js`. Only change: `nextUid` moves from module state to a per-call counter (module state made two concurrent sessions share uids). |
| `server/cdp/snapshot-cache.js` (deleted) | **replace** | A global `Map` keyed on `browserUrl::targetId` is exactly the kind of process-wide mutable state V2 deletes elsewhere. The snapshot now lives on the session object and is invalidated on navigate. |
| `server/cdp/browser-tools.js` (deleted) | **not ported here** | These are *tools*, i.e. P5-B. P5-A stops at the driver API they will wrap. |
| `server/browser-screenshot-middleware.js` | **reuse, untouched** | The driver writes through `writeScreenshot()`; this route keeps serving the PNGs. |
| `server/browser-allowlist-middleware.js` | **reuse, untouched** | The driver calls `cdp/allowlist.js` in-process. No HTTP hop from the engine to itself. |
| `server/preview/*` | **out of scope** | Static file serving. Not a browser. |
| `src/tools/browser-preview-tools.ts` | **replace, do not port** | Renderer-only and Electron-IPC-bound. Porting it means porting `window.minnow.preview`, i.e. requiring a live desktop shell for an unattended overnight run — the opposite of the goal. Left in place for the interactive browser panel; the driver is a parallel path. |
| `src/tools/browser-navigation-gate.ts` | **do not port** | It is an interactive approval flow with a user-prompt lock, and it already refuses to run AFK (`blockAfkInteractionAttempt`). An unattended Final Tester gets the allowlist verdict and nothing else — no prompt, no grant. |
| `src/tools/browser-preview-snapshot.ts` | **superseded** | Its in-page DOM walk is a workaround for not having CDP. The driver has CDP, so it uses the real `Accessibility` domain. Left in place for the renderer path. |
| `src/tools/browser-allowlist-match.ts` | **leave, note the duplication** | It is a renderer mirror of `server/cdp/allowlist.js`. The driver uses the server copy. Deduping it is a renderer change with no bearing on P5-A. |
| `src/tools/browser-executor.ts` | **irrelevant** | Contains no browser automation despite the name. |

**Net:** three server modules reused untouched, three deleted modules restored and
hardened, one replaced, and everything renderer-side deliberately not ported.

---

## 3. Host decision: raw CDP over `ws`, not Playwright, not puppeteer-core

### Candidates

**A. Playwright** — Rejected.
- New runtime dependency plus a **browser download step** (`playwright install`, hundreds of MB) executed at install time. This repo has a deliberate packaging discipline (`scripts/validate-packaged-runtime-files.mjs`, `scripts/clean-release.mjs`, an asar bundle, and a documented 18 MB orphan that was treated as a defect worth deleting). A per-platform browser payload is not a proportionate cost for one ladder rung.
- Playwright brings its own process supervision, which is most of what P5-A is *for*; we would be adopting a large dependency to obtain roughly 200 lines of `spawn` + `taskkill` we have to write and test anyway (the Windows kill path in particular — `server/terminal-runner.js` already carries a hardened one that took several rounds to get right).
- Its value is cross-browser (WebKit/Firefox) and auto-waiting selectors. The Final Tester needs neither: it verifies *the app the agent just built* in one Chromium, and the verification path is deliberately DOM/console reads, not selector choreography.

**B. `puppeteer-core`** — Rejected, but closest.
- No bundled browser (good), a mature `Connection`/`CDPSession` layer, and real process teardown.
- But it does **not** solve browser discovery — `puppeteer-core` requires an `executablePath`, so the platform-probing code gets written either way.
- It is still a new runtime dependency in a repo whose entire server ships untranspiled and dependency-light, for a surface we measured at ~350 lines of transport.

**C. Extend `server/cdp/` with a real launcher — Chosen.**

The evidence that decided it:

1. **`ws` is already a runtime dependency** (`package.json` `dependencies`), not a dev one. The transport needs no new package.
2. **`devtools-protocol` is already a devDependency**, so protocol typings are available for the `.d.ts` without adding anything.
3. **A working CDP client already exists in this repo's history** (`86cc513f^:server/cdp/client.js`), MIT-sourced, 105 lines, and was in production use before it was dropped for reasons — routing tools through Electron — that do not apply to a headless server-side driver.
4. **The policy layer we would otherwise have to re-bridge is already server-side and in the right shape**: allowlist, config, and screenshot paths. A Playwright/puppeteer host would still have to call exactly these three modules.
5. **A Chromium binary is discoverable, not shippable.** Chrome and/or Edge are present on essentially every Windows box (Edge is part of the OS), and this machine has both. Bundling one is the only reason to take Playwright, and bundling one is what the packaging discipline forbids.

**Explicitly considered and rejected: driving the bundled Electron binary.** Electron is
a devDependency and *is* Chromium, but it cannot act as a browser — it requires an app
entry point and has no `about:blank` browser shell to attach to. It is also absent from
the packaged app's `node_modules`. Discovery of a real installed browser is the only
path that works both in dev and in a shipped app.

**Deferred, not rejected: `--remote-debugging-pipe`.** Chrome's pipe transport (fds 3/4)
removes the `ws` dependency, the loopback port, and the `DevToolsActivePort` race
entirely, and it is what puppeteer prefers. It is a strictly better transport and a
contained future change behind `cdp-client.js`. It is not in P5-A because the WebSocket
path is the one with proven prior code in this repo, and P5-A's risk budget belongs to
the lifecycle, not the transport.

### Consequence

Zero new dependencies. `package.json` is unmodified by this issue.

---

## 4. What P5-A therefore builds (`server/browser-driver/`)

Only the parts that genuinely do not exist:

| File | Purpose |
|---|---|
| `discover.js` | Platform-specific executable probing; `probeBrowserCapability()` returns a **report**, never throws. |
| `launch-options.js` | Pure: normalize options, build the Chromium argv (isolation flags, `--remote-debugging-port=0`). |
| `process.js` | Spawn, `DevToolsActivePort` handshake, health check, supervised kill (`taskkill /T /F` on win32, process-group `SIGTERM`→`SIGKILL` elsewhere), a process-wide orphan registry drained on host exit. |
| `profile.js` | A dedicated profile dir per run under `~/.minnow/browser-profiles/`, torn down afterwards with Windows lock-retry. |
| `cdp-client.js` | The restored + hardened CDP transport. |
| `snapshot.js` | The restored a11y tree. |
| `session.js` | `BrowserSession`: allowlist-checked `navigate`, `text`, `html`, `snapshot`, `evaluate`, `consoleMessages`, `screenshot`, `status`, `close`, `kill`. |
| `index.js` / `index.d.ts` | Public surface for P5-B. |

### Hazards from the issue, and how they are handled

- **"Screenshots hang / transitions freeze."** No assertion in the driver or its tests depends on a screenshot. `screenshot()` exists, is optional, has its own deadline, and returns a path for humans. Every verification read is `Runtime.evaluate` or `Accessibility.getFullAXTree`, plus buffered console/exception events.
- **"Custom devtools teardown is fiddly."** The driver never opens devtools. `--remote-debugging-port` is a protocol endpoint, not a devtools window; `setDevToolsWebContents` is Electron renderer machinery the driver does not touch.
- **"Vite's preview server auto-increments the port."** The driver never assumes a URL. Callers pass one. The driver's *own* port problem is solved the same way the issue recommends — by inspection, not assumption: Chrome is launched with `--remote-debugging-port=0` and the real port is read back from the `DevToolsActivePort` file the browser writes into its profile dir.
- **"A hung browser must never hang the engine."** Three independent stops: a per-CDP-call deadline; a navigation deadline that, on expiry, probes browser-level liveness and force-kills if the browser itself is unresponsive; and an absolute session `hardTimeoutMs` watchdog that kills regardless. Every path ends with the profile removed and the session marked dead, and every later call on a dead session rejects immediately instead of waiting.
- **"No browser available must degrade, not crash."** `probeBrowserCapability()` and `launchBrowser()` both return `{ available: false, reason, ... }` / `{ ok: false, reason, ... }`. Nothing in the module throws for an absent or disabled browser.

### Deliberately out of scope

Tool definitions and prompt wiring (P5-B), the ladder rung (P5-C), and run harnesses
(P5-D). Also: clicking, typing, and form interaction. The driver exposes `evaluate`, on
which P5-B can build `click`/`fill` against snapshot uids; committing to an interaction
API before the tool surface exists would be guessing at its shape.
