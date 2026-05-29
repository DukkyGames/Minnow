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
| **2** | [MIN-111](https://linear.app/minnowai/issue/MIN-111) | `electron/server-host.ts` — Connect + `sirv` + PTY WS on dynamic port (shipped) |
| **3** | [MIN-112](https://linear.app/minnowai/issue/MIN-112) | `WebContentsView` preview; delete `preview-embed-detect`; rewrite `preview-panel.ts` |
| **4** | [MIN-113](https://linear.app/minnowai/issue/MIN-113) | `electron-builder` Windows NSIS; `asarUnpack` for `@lydell/node-pty` (**shipped**) |
| **5** | [MIN-114](https://linear.app/minnowai/issue/MIN-114) | Optional polish: native folder picker, menu, tray, `minnow://`, updater, frameless titlebar |

**Dependency chain:** P0 → (P1 ∥ P2) → P3 → P4 → P5 (optional).

---

## Agent entry points

| Topic | Location |
|-------|----------|
| Dev server + middleware today | `server.js` (~866–898 middleware, ~904–916 bootstrap) |
| Preview WebContentsView (MIN-112) | `electron/preview-host.ts`, `src/ui/preview-panel.ts`, `index.html` `#previewBody` |
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
| `npm run electron:build` | `tsc -p electron/tsconfig.json` → `electron/dist/` |
| `npm run electron:dev` | Vite + Electron window (HMR) |
| `npm run electron:prod` | Built `dist/` + in-process server (requires MIN-111 `server-host`) |
| `npm run package` | Full Windows NSIS installer under `release/` (MIN-113) |
| `npm run package:dir` | Unpacked `release/win-unpacked/` only (faster packaging smoke test) |

Layout: `electron/main.ts`, `preload.ts`, `ipc-channels.ts`, `window-state.ts`, `server-import.ts`, `server-host.ts`, `preview-host.ts`; renderer types in `src/electron.d.ts`.

Env: `MINNOW_ELECTRON=1` (suppress browser auto-open), `MINNOW_ELECTRON_DEV=1` (skip in-process server, use :5173).

---

## Windows packaging (MIN-113)

**Entry:** `package.json` `"main": "electron/dist/main.js"` (compiled by `npm run electron:build`).

**Scripts:**

- `npm run package` — `npm run build` → `npm run electron:build` → `electron-builder` (NSIS).
- `npm run package:dir` — same build steps, then `electron-builder --dir` (no installer).

**`package.json` `"build"` field** (electron-builder):

| Key | Value |
|-----|--------|
| `appId` | `org.grimmedia.minnow` |
| `productName` | `Minnow` |
| `directories.output` | `release` |
| `files` | `dist/**`, `electron/dist/**`, `server/**`, `scripts/generate-skills-manifest.mjs`, `package.json`, `skills-lock.json`; exclude `**/*.map` |
| `asarUnpack` | `node_modules/@lydell/node-pty/**` (native PTY binaries) |
| `extraResources` | `documentation/` → `resources/documentation` |
| `win.target` | `nsis` |
| `win.icon` | `build/icon.ico` |
| `nsis.artifactName` | `${productName}-Setup-${version}.${ext}` (avoids spaces in NSIS output path on Windows) |

**Icon:** `build/icon.ico` must include at least a **256×256** bitmap (electron-builder rejects smaller `.ico` files). Regenerate from the repo logo when updating branding:

```bash
npx png-to-ico public/logos/minnow-logo/minnow/png/minnow-256.png > build/icon.ico
```

**Output (gitignored):**

- `release/win-unpacked/` — runnable `Minnow.exe` (dir target).
- `release/Minnow-Setup-<version>.exe` — NSIS installer (`npm run package`; artifact name avoids spaces in the default NSIS output path).

**Verification:** Close any running `Minnow.exe` / `electron.exe` from a prior unpack before re-packaging (Windows file locks on `app.asar.unpacked` / PTY). `npm run build` and `npm run electron:build` must pass first (`tsc` + Vite).

**Out of scope (v1):** code signing, `electron-updater`, macOS/Linux targets (MIN-114 polish).
