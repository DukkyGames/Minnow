---
name: react-ui-migration-spec
overview: "Build specification for converting the Minnow SPA from vanilla imperative DOM TypeScript to React 19, targeting all first-party UI surfaces via a big bang branch with feature-flag coexistence, Zustand state management, React Router, and Vitest + @testing-library/react for testing."
todos: []
isProject: false
---

# Build Spec: React UI Framework Migration

**Date:** 2026-07-29
**Goal:** Convert every first-party UI surface of the Minnow SPA from vanilla imperative DOM TypeScript to React 19, running in a parallel branch that merges feature-flagged into main when parity is reached. The tool server, streaming engine, session persistence, and Electron IPC semantics remain unchanged — only the rendering layer is replaced.
**Granularity:** medium

---

## Scope

### In scope — all first-party UI surfaces

| Surface | Current path(s) | Replacement |
|---------|-----------------|-------------|
| Desktop shell (Minnow Shell, dock, wallpaper, concierge) | `src/os/`, `src/ui/hub.ts` | React root mount, feature-based components |
| Chat workspace (message list, composer, streaming, stats strip, sidebar) | `src/chat/`, `src/ui/messages.ts`, `src/ui/input.ts`, `src/ui/sidebar.ts`, `src/ui/stats.ts` | React component tree, Zustand-bridged streaming |
| Code workspace (file tree, editor tabs, git panel, terminal, LSP) | `src/ui/file-tree.ts`, `src/ui/file-viewer.ts`, `src/ui/git-panel.ts`, `src/ui/terminal-panel.ts` | Feature-based React pages + components |
| Brain app & memory | `src/ui/brain/` | React page + components |
| Models app | `src/ui/models/` | React page + components |
| Settings app | `src/ui/settings-*.ts` | React page + components |
| Issues app | `src/ui/issues-*.ts` | React page + components |
| Research panel | `src/ui/research/` | React components |
| Scheduler overlay | `src/ui/scheduler/` | React components |
| Onboarding wizard | `src/onboarding/`, `src/ui/onboarding/` | React components |
| Top bar, model picker, mode selector | `src/ui/model-select-picker.ts`, `src/ui/mode-selector.ts`, `src/ui/stats.ts` | React components |
| Composer (input, tools popover, voice, undo, slash picker, model triggers, skill picker, pinned skill) | `src/ui/input.ts`, `src/ui/composer-*.ts`, `src/ui/skill-picker.ts` | React component composition |
| Notifications (bell, toast, sound) | `src/ui/notifications/`, `src/ui/toast.ts` | React components |
| Boot/app-ready loading shell | `src/main.ts`, `src/boot/app-ready.ts` | BootProvider that tracks async setup steps |

### Out of scope (unchanged, reused verbatim)

- **Tool server** (`server/`, ~70 JS files) — HTTP/SSE/WebSocket API, framework-agnostic. Zero changes unless a response shape must adapt for React rendering.
- **Streaming engine** (`src/tools/loop.ts`, `src/api/generations.ts`, `src/api/sse-parse.ts`) — continues writing to a Zustand bridge store. React reads from the same store.
- **Session persistence** (`src/state/sessions.ts`, `server/config/sessions-*`) — unchanged protocol and storage.
- **Tool definitions & dispatch** (`src/tools/definitions.ts`, `src/tools/client.ts`) — unchanged.
- **Providers & models** (`src/providers/`, `src/api/models.ts`) — unchanged.
- **Agents, sub-agents, work agents** (`src/agents/`) — unchanged behavior; UI rendering of agent cards/drawers moves to React.
- **Skill system** (`src/skills/`, `src/skills/library/`) — unchanged.
- **Electron main process** (`electron/main.ts`, `electron/preload.ts`, `electron/tray.ts`) — unchanged; the preload bridge gets a React-friendly context provider wrapper on the SPA side.
- **CSS token system** (`--mn-*` variables, `tokens.css`, 60+ global stylesheets) — unchanged. No CSS-in-JS, no CSS Modules. Components use `className` and `var(--mn-*)` exactly as vanilla code does.
- **Service worker** (`public/sw.js`) — unchanged.
- **PWA manifest** — unchanged.

---

## MVP boundaries

The minimum viable product for the big bang branch is **one fully functional surface that proves the entire stack works end-to-end**: Chat workspace (message list, composer, streaming display, stats strip, sidebar, top bar, mode selector). This validates:

- React mounts inside the Electron/SPA shell and replaces the existing DOM
- Zustand stores bridge streaming deltas from the vanilla tool loop to React components
- React Router handles hash-based navigation without the legacy router
- The BootProvider sequence works (critical state loaded → app reveals → non-critical hydrates)
- The ThemeProvider context reads `data-theme` and exposes resolved values
- Electron IPC is accessible via React hooks through a context provider
- Vitest + `@testing-library/react` tests pass

After Chat parity is validated, the remaining surfaces (Code, Brain, Models, Settings, Issues, Research, Scheduler, Desktop shell) convert in parallel waves.

**Not in MVP:** Code workspace, Brain app, Models app, Settings app, Issues app, Research panel, Scheduler, Onboarding, full Desktop shell. These follow sequentially once the Chat workspace is stable.

---

## Constraints

### Non-negotiable

- **Existing streaming must not degrade.** The SSE-to-Zustand bridge must match the current update latency. No rendering pipeline may block or buffer the delta stream.
- **All --mn-* CSS tokens remain the source of truth.** No CSS-in-JS or runtime-generated class names. The ThemeProvider wraps the app but CSS variables stay on `<html>`.
- **The tool loop and session persistence are untouched.** No changes to `src/tools/loop.ts`, `src/state/sessions.ts`, or the server generation pipeline. The React app is a new consumer of the same stores and API.
- **Every route must work from the first React commit.** The hash-based router is replaced entirely, not composed with the existing one. Legacy hash redirects (`#/settings/providers` → `#/app/models/providers`, `#/bugs` → `#/app/issues`) must be preserved.
- **Feature-flag coexistence.** The React build and the existing vanilla build live side by side behind a flag (e.g. `localStorage` key `minnow.reactUI` or a Vite `define` constant). Switching between them does not lose session state.

### Trade-offs accepted

- **Bundle weight.** React 19 + react-dom + react-router-dom + Zustand adds ~50–70 kB gzipped. Accepted — the app already ships CodeMirror (20+ languages), xterm, recharts, and d3.
- **Streaming display is not rewritten.** The tool loop writes to a Zustand store; React components read from it. The streaming engine itself remains vanilla. This is a bridge, not a replacement.
- **Big bang risk.** The parallel branch means weeks with no user-visible progress on main. Merging a large diff that touches every UI file. Mitigated by feature-flagging (merge early behind the flag, enable incrementally).
- **Old vanilla code is not deleted immediately.** Both implementations coexist. Vanilla code is removed only after the React flag is default-on and stable for a release cycle — possibly months after initial merge.

---

## Key files

### Entry & boot

| File | Role | Action |
|------|------|--------|
| `index.html` | SPA shell | MODIFY — mount `<div id="react-root">` alongside or replacing existing shell |
| `src/main.ts` | Client bootstrap | MODIFY — add feature-flag check; conditionally mount React root or run existing `initApp()` |
| `src/boot/app-ready.ts` | Loader dismiss | UNCHANGED — boot goes through the same dismiss logic |
| `src/theme.ts` | Theme init | UNCHANGED — data-theme set before React mounts |

### New React entry files (CREATE)

| File | Role |
|------|------|
| `src/react/main.tsx` | React root mount, Provider tree (Boot, Theme, Router, Zustand, Electron) |
| `src/react/App.tsx` | Top-level router + layout shell |
| `src/react/providers/BootProvider.tsx` | Async boot sequence (sessions → config → tools → models → first paint) |
| `src/react/providers/ThemeProvider.tsx` | Reads `data-theme`, exposes resolved tokens via context |
| `src/react/providers/ElectronBridgeProvider.tsx` | Wraps `window.__*` IPC globals in React context + hooks |
| `src/react/providers/ZustandBridgeProvider.tsx` | (optional) Context w/ store references for DI/testability |

### State (Zustand stores — CREATE)

| File | Role |
|------|------|
| `src/react/stores/sessionStore.ts` | Active chat, sidebar state, group state |
| `src/react/stores/streamStore.ts` | Streaming delta buffer, current stats, generation status |
| `src/react/stores/configStore.ts` | Tool permissions, theme, user preferences |
| `src/react/stores/uiStore.ts` | Drawer open/close, sidebar collapsed, composer state |

### Routing (React Router — CREATE)

| File | Role |
|------|------|
| `src/react/router/routeConfig.tsx` | Route definitions matching current `#/*` hash scheme |
| `src/react/router/legacyRedirects.ts` | All legacy hash redirects (settings → models, bugs → issues, etc.) |

### Surface: Chat (CREATE)

| File | Role |
|------|------|
| `src/react/pages/chat/ChatPage.tsx` | Chat top-level layout (sidebar + messages + composer + stats strip) |
| `src/react/pages/chat/components/MessageList.tsx` | Virtualized message scroll renderer, reads from streamStore |
| `src/react/pages/chat/components/MessageBubble.tsx` | User/assistant/tool message bubble |
| `src/react/pages/chat/components/Composer.tsx` | Textarea, send, attachments, tools popover |
| `src/react/pages/chat/components/ComposerToolsPopover.tsx` | Tool permission segmented controls for the active chat |
| `src/react/pages/chat/components/StatsStrip.tsx` | Bottom metric strip (TPS, TTFT, tokens, bars) |
| `src/react/pages/chat/components/Sidebar.tsx` | Session list, groups, search |
| `src/react/pages/chat/components/SidebarSessionRow.tsx` | Individual chat row (name, preview, loop icon, model chip) |
| `src/react/pages/chat/components/TopBar.tsx` | App title, model picker, mode selector, window controls |
| `src/react/pages/chat/components/ModelSelectPicker.tsx` | Model catalog dropdown |
| `src/react/pages/chat/components/ModeSelector.tsx` | Composer mode strip |
| `src/react/pages/chat/components/SkillPicker.tsx` | `/` slash command popup |
| `src/react/pages/chat/components/ToolCallDiffView.tsx` | Tool-call diff expando blocks |
| `src/react/pages/chat/components/BranchPicker.tsx` | Turn run branch selector |
| `src/react/pages/chat/components/SubAgentCards.tsx` | Sub-agent live activity cards |
| `src/react/pages/chat/components/SubAgentDrawer.tsx` | Sub-agent detail drawer |
| `src/react/pages/chat/components/Toast.tsx` | Toast notification system |

### Surfaces: Code, Brain, Models, Settings, Issues (CREATE)

| File | Role |
|------|------|
| `src/react/pages/code/CodePage.tsx` | Code workspace root (file tree + editor + terminal + git) |
| `src/react/pages/brain/BrainPage.tsx` | Brain wiki + graph + memories |
| `src/react/pages/models/ModelsPage.tsx` | Models discovery + download + providers + routing |
| `src/react/pages/settings/SettingsPage.tsx` | Full settings drawer replacement |
| `src/react/pages/issues/IssuesPage.tsx` | Issues list + board + detail |

### Surface: Desktop shell (CREATE)

| File | Role |
|------|------|
| `src/react/pages/desktop/DesktopShell.tsx` | Wallpaper, dock, concierge, OS shell layers |
| `src/react/pages/desktop/components/Dock.tsx` | App dock icons + launch |
| `src/react/pages/desktop/components/Wallpaper.tsx` | Wallpaper background surface |
| `src/react/pages/desktop/components/NotificationsBell.tsx` | Notification bell + menu |

### Bridges & shared utilities (CREATE)

| File | Role |
|------|------|
| `src/react/bridges/streamBridge.ts` | Exports `streamStore` actions that the vanilla tool loop calls; sets up subscriptions |
| `src/react/bridges/electronBridge.ts` | Context + `useElectron` hook for tray, window state, IPC |
| `src/react/hooks/useActiveChat.ts` | Reads sessionStore + streamStore for the active chat |
| `src/react/hooks/useTheme.ts` | Consumes ThemeProvider context |
| `src/react/hooks/useToolPermission.ts` | Reads configStore for a tool's permission level |
| `src/react/lib/chat-utils.ts` | Date formatting, token display, preview truncation |

### Config & build

| File | Role | Action |
|------|------|--------|
| `vite.config.ts` | Vite plugins | MODIFY — add `@vitejs/plugin-react`, remove `cssBeforeEntryScriptPlugin` |
| `tsconfig.json` | TypeScript config | MODIFY — add `"jsx": "react-jsx"` |
| `src/react/tsconfig.json` | React-specific TS config | CREATE — strict mode enabled for new code |
| `package.json` | Dependencies | MODIFY — add `react-router-dom`, `zustand`, `@vitejs/plugin-react`, `@testing-library/react`, `vitest`, `@playwright/test` |

### Test files (CREATE)

| File | Role |
|------|------|
| `src/react/pages/chat/components/MessageList.test.tsx` | Renders streaming content from Zustand store |
| `src/react/pages/chat/components/Composer.test.tsx` | Send, attach, tool popover interactions |
| `src/react/pages/chat/components/StatsStrip.test.tsx` | Metric rendering, responsive collapse |
| `src/react/pages/chat/components/Sidebar.test.tsx` | Session list, search, group rendering |
| `src/react/pages/chat/components/ModeSelector.test.tsx` | Mode chip selection |
| `src/react/providers/BootProvider.test.tsx` | Loading shell → ready transition |
| `src/react/providers/ThemeProvider.test.tsx` | Returns correct tokens per data-theme value |
| `src/react/stores/streamStore.test.ts` | Delta accumulation, throttling, status transitions |

---

## Architecture decisions (from grill)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Migration strategy** | Big bang in parallel branch | All surfaces at once; flip the switch when parity reached. Coexistence via feature flag after merge. |
| **State management** | Zustand (multi-store by domain) | Lightweight, vanilla JS can subscribe, no provider wrapping needed for non-React code. Separate sessions, streaming, config, and UI stores. |
| **Routing** | React Router (replaces hash router) | Standard nested routing. Legacy hash redirects preserved in a redirect layer. |
| **Streaming rendering** | Zustand bridge from vanilla tool loop | Tool loop writes to `streamStore`. React components read from it via `useStore()`. Streaming engine itself is not rewritten. |
| **Boot sequence** | BootProvider with critical-path state gate | Renders a branded loading shell until sessions + config + tools are loaded. Non-critical steps hydrate via `useEffect` after first paint. |
| **Theme system** | React context (ThemeProvider) over CSS variables | `--mn-*` tokens remain the source of truth on `<html>`. Context exposes resolved values for JS-driven rendering (charts, custom components). |
| **CSS architecture** | Unchanged: global CSS files + `className` + `var(--mn-*)` | No CSS Modules, no CSS-in-JS. All 60+ stylesheets stay in `src/styles/`, imported at the app root. |
| **Electron bridge** | Convert to React context + hooks | `ElectronBridgeProvider` wraps `window.__*` globals. Components use `useElectron()` instead of reading globals directly. |
| **Testing** | Vitest + `@testing-library/react` | Runs in Vite's build pipeline. `happy-dom` as the DOM environment. |
| **Parity validation** | Visual regression with Playwright | Screenshot diffs for every route/view against the vanilla baseline. CI gate on pixel changes. |
| **Feature flag** | Toggle between builds | Mechanism TBD (`localStorage`, Vite `define`, or Electron `config.json`). Both builds ship in the same bundle initially. |
| **Dead code deletion** | After flag is default-on for one release cycle | Vanilla code deleted when the feature flag becomes the only path. |
| **Code organization** | Feature-based | Components co-located with their feature (`chat/components/ChatMessage.tsx`). Tests next to components. |
| **Store architecture** | Multi-store by domain | Separate Zustand stores for sessions, streaming, config, and UI. Selectors subscribe only to their slice. |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Streaming latency regression** | High — chat feels sluggish or choppy | Keep streaming as vanilla DOM → Zustand bridge. No React render cycle between SSE chunk and visible text. Benchmark before/after. |
| **Boot sequence timing breaks** | High — app hangs on loading shell | BootProvider mirrors the existing `initApp()` steps in the same order. Non-React modules load identically. Test boot sequence in CI. |
| **Feature flag complexity** | Medium — two UI trees in one bundle doubles surface area for bugs | Keep the flag simple (switch on app mount, never toggle mid-session). Vanilla and React trees are independent. |
| **Hash router replacement misses legacy redirects** | Medium — deep links break | Enumerate every legacy hash pattern from `resolveLegacyHash()` in `src/os/router.ts` and replicate in React Router's redirect layer. |
| **Electron IPC gap** | Medium — tray/window state features don't work | ElectronBridgeProvider abstraction with fallback detection. Test each IPC channel during Chat MVP. |
| **Large diff/branch drift** | Low — long-lived branch diverges from main | Merge feature-flagged into main early (even if only Chat MVP works). Prevents drift. |
| **Zustand bridge coupling** | Low — tool loop writes to a consumer it doesn't import | Zustand stores are vanilla JS modules with no React dependency. Tool loop imports the store module and calls `store.getState()`, `store.setState()`. No coupling. |
| **4–6 month timeline** | Medium — motivation/sustaining energy | Chunk into wave milestones. Chat MVP first (gives visible progress), then parallel waves for remaining surfaces. |

---

## Acceptance criteria

### Greenfield (React branch merges to main)

- [ ] Chat workspace renders all messages, streaming, composer, stats strip, sidebar, top bar, mode selector, and model picker with no visual regression against the vanilla baseline (Playwright screenshot comparison)
- [ ] Every hash route (`#/`, `#/desktop`, `#/app/code`, `#/app/settings`, `#/app/issues`, `#/app/brain`, `#/app/models`, `#/app/bench`, `#/app/scheduler`, legacy `#/settings/*` → `#/app/models/*`, `#/bugs` → `#/app/issues`) navigates correctly via React Router
- [ ] Streaming generation renders characters with no perceptible latency difference from the vanilla build (measured via SSE arrival → DOM paint timing)
- [ ] Tool-loop rounds complete successfully: user message → assistant thinks → tool calls execute → results render → follow-up generation
- [ ] Zustand stores persist across chat switches and session reloads (streamStore, sessionStore, configStore)
- [ ] Feature flag switches between React and vanilla builds at boot without corrupting session state
- [ ] `npm test` passes (Vitest for React components + existing node:test suites for non-UI code)
- [ ] `npm run build` produces a working bundle
- [ ] Electron shell (frameless window, tray, minimize-to-tray, close button) functions identically in the React build
- [ ] Theme switching (16 themes) works in the React build — all `--mn-*` tokens resolve correctly across surfaces
- [ ] Visual regression CI gate (Playwright) shows zero unexpected diffs against the vanilla baseline for supported routes

### Stretch (post-MVP, pre-full-deletion)

- [ ] Code workspace (file tree, CodeMirror editors, git panel, terminal, LSP diagnostics, file viewer, editor tabs) renders in React with parity
- [ ] Brain app (wiki graph, page viewer, memory list, search, proposals) renders in React
- [ ] Models app (hardware info, downloader, provider list, routing config) renders in React
- [ ] Settings app (all sections: General, Appearance, Models, Integrations, Advanced) renders in React
- [ ] Issues app (list, board, detail, labels, git links) renders in React
- [ ] Desktop shell (wallpaper, dock, concierge composer, notifications) renders in React
- [ ] Vanilla code deleted, feature flag removed, React build is the only build

---

## Risks not accepted / known unknowns

- **CodeMirror 6 integration.** The existing file viewer and editor use imperative CodeMirror 6 instances. These are complex stateful surfaces (history, decorations, lint gutter, keybindings, language modes). The React wrapper must mount/unmount and sync with CodeMirror's own state model — this is a known hard problem in every React + CodeMirror migration. Solution deferred until the Code workspace wave.
- **Terminal panel (xterm.js).** Similar to CodeMirror — imperative terminal widget with its own state. Electron PTY WebSocket streams into xterm. The React component wraps the xterm instance. Deferred to the Code workspace wave.
- **Performance of React streaming with high-frequency token updates.** Estimated to be fine because the Zustand bridge separates the streaming hot path from the React render cycle, but if the message list re-renders on every token, it may need `React.memo` + virtualization. Measurable only during Chat MVP.
