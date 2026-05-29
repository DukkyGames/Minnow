# Electron wrapper — Minnow desktop app

**Canonical spec (Linear):** [Electron wrapper project](https://linear.app/minnowai/project/electron-wrapper-549883cbfbe1)

**Architecture:** Hybrid in-process Node server (prod) + Vite dev server (dev) + `WebContentsView` preview replacing the preview `<iframe>`.

**Out of scope for v1:** macOS/Linux installers, code signing, `electron-updater`, POLISH-011 CDP screencast mirror (separate plan).

---

## Phase → Linear issue

| Phase | Issue | Summary |
|-------|--------|---------|
| **0** | [MIN-109](https://linear.app/minnowai/issue/MIN-109) | Extract `server/runtime/*` (middlewares, bootstrap, path-access, tools); `setAppRoot`; `MINNOW_ELECTRON` auto-open gate |
| **1** | [MIN-110](https://linear.app/minnowai/issue/MIN-110) | `electron/` shell: main, preload, `electron:dev` / `electron:prod` scripts |
| **2** | [MIN-111](https://linear.app/minnowai/issue/MIN-111) | `electron/server-host.ts` — Connect + `sirv` + PTY WS on dynamic port |
| **3** | [MIN-112](https://linear.app/minnowai/issue/MIN-112) | `WebContentsView` preview; delete `preview-embed-detect`; rewrite `preview-panel.ts` |
| **4** | [MIN-113](https://linear.app/minnowai/issue/MIN-113) | `electron-builder` Windows NSIS; `asarUnpack` for `@lydell/node-pty` |
| **5** | [MIN-114](https://linear.app/minnowai/issue/MIN-114) | Optional polish: native folder picker, menu, tray, `minnow://`, updater, frameless titlebar |

**Dependency chain:** P0 → (P1 ∥ P2) → P3 → P4 → P5 (optional).

---

## Agent entry points

| Topic | Location |
|-------|----------|
| Dev server + middleware today | `server.js` (~866–898 middleware, ~904–916 bootstrap) |
| Preview iframe (remove in P3) | `index.html`, `src/ui/preview-panel.ts`, `src/ui/preview-embed-detect.ts` |
| Preview file API | `server/preview/middleware.js` |
| App vs workspace root | `server/workspace/root.js` |
| PTY WebSocket | `attachPtyWebSocketServer` in `server.js` |
| Headless CLI (must stay untouched) | `bin/minnow.mjs`, `AGENTS.md` |
| Full verification checklist | Linear project description → **Verification** section |

---

## Commands (after implementation)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Browser + Vite (unchanged) |
| `npm run electron:dev` | Vite + Electron window (HMR) |
| `npm run electron:prod` | Built `dist/` + in-process server |
| `npm run package` | Windows installer under `release/` |

Env: `MINNOW_ELECTRON=1` (suppress browser auto-open), `MINNOW_ELECTRON_DEV=1` (skip in-process server, use :5173).
