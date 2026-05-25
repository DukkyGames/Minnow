---
name: POLISH-016 — Workspace welcome screen
overview: On first launch (or when workspace is still the Minnow app default), show a Cursor-style workspace select home instead of dropping users into chat with no project context.
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-016)
status: planned
severity: polish
todos:
  - id: product-gate
    content: Confirm welcome gate uses isDefaultWorkspace (not empty path) and whether “continue in Minnow folder” is allowed
    status: pending
  - id: route-shell
    content: Add #/welcome route, index.html #welcomeView shell, and hide #appBody until a real workspace is chosen
    status: pending
  - id: welcome-module
    content: Implement src/ui/welcome-page.ts (open/close, hashchange, boot redirect) following global-bugs/benchmark patterns
    status: pending
  - id: welcome-ui
    content: Build welcome layout — brand header, primary tiles, recent list (name + path), offline npm start message
    status: pending
  - id: reuse-workspace-apis
    content: Wire Open folder + recents via fetchWorkspace, setWorkspacePath, applyWorkspaceSwitch, openWorkspaceFolderPicker
    status: pending
  - id: hash-coordination
    content: Integrate welcome with settings-page, global-bugs-page, benchmark-page hash handlers (close peers on open)
    status: pending
  - id: styles-a11y
    content: Add workspace-welcome-page.css — tokens, focus, keyboard, responsive; optional Impeccable pass
    status: pending
  - id: tests
    content: Add test/ui/welcome-page.test.mjs for gate, recent select, hash, and server-unavailable copy
    status: pending
  - id: docs-context
    content: Update documentation/context.md workspace section when shipped; mark POLISH-016 in bug-hunt doc
    status: pending
isProject: false
---

# POLISH-016 — Workspace select on first open (Cursor-style)

**Tracker:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — POLISH-016 (Polish, Requested)  
**Architecture ref:** [context.md](../../context.md) — Workspace root, MRU, folder picker, hash routes

**No implementation in this document** — plan only.

---

## Summary

Minnow always boots with a **valid workspace path** (the Minnow install directory when nothing is persisted). Users still land in the full chat shell with file tree and composer scoped to that default folder, which feels like “no project selected” compared to Cursor’s empty-window **workspace home**.

This polish item adds a dedicated **welcome / workspace select** screen on cold start when the active workspace is still the **default app root**, then transitions into the normal app after the user opens or picks a real project folder.

---

## Product reference (Cursor)

From bug-hunt session notes and screenshot:

| Region | Cursor pattern | Minnow v1 adaptation |
|--------|----------------|----------------------|
| Header | Logo + product name; secondary links (plan, Settings) | `.topbar-brand` + link/button to `#/settings/general` |
| Primary tiles | Open project · Clone repo · Connect via SSH | **Open folder** (in-app picker); optional **Open recent** scroll target; defer clone/SSH |
| Recents | Name (left) + path (right); “View all (N)” | Reuse `GET /api/workspace` `recent[]`; cap display (e.g. 10) with expand if needed |
| Workspace files | `*.code-workspace` | **Out of scope** v1 (no multi-root workspace file type) |

---

## Current state

| Piece | Behavior today | Key files |
|-------|----------------|-----------|
| Server workspace | `initWorkspaceRoot()` loads `~/.minnow/config.json` → `workspace.path`, else **`APP_ROOT`** (cwd where `npm start` ran) | [`server/workspace/root.js`](../../../server/workspace/root.js) |
| `isDefault` flag | `true` when resolved workspace === `APP_ROOT` | `getWorkspaceInfo()` in same file |
| Client sync | `refreshWorkspaceUi()` → `loadWorkspaceFromServer()`; label on `#btnWorkspace` | [`src/ui/workspace-button.ts`](../../../src/ui/workspace-button.ts), [`src/state/workspace.ts`](../../../src/state/workspace.ts) |
| Change workspace | Top-bar popover MRU + **Open new workspace…** → in-app folder browser | [`src/ui/workspace-recent-menu.ts`](../../../src/ui/workspace-recent-menu.ts), [`src/ui/workspace-folder-picker.ts`](../../../src/ui/workspace-folder-picker.ts) |
| MRU persistence | `workspace.recentPaths` in `config.json`, max 10 | `touchRecentWorkspacePath`, `buildRecentWorkspaceList` |
| App boot | `initApp()` always renders chat shell; no welcome gate | [`src/main.ts`](../../../src/main.ts) |
| Full-page routes | `#/settings/*`, `#/benchmark`, `#/bugs` toggle sibling views vs `#appBody` | [`src/ui/settings-page.ts`](../../../src/ui/settings-page.ts), [`src/ui/benchmark-page.ts`](../../../src/ui/benchmark-page.ts), [`src/ui/global-bugs-page.ts`](../../../src/ui/global-bugs-page.ts) |

**Important:** `getWorkspacePath()` is **never empty** on a successful `GET /api/workspace` — the gate for “no project context” must be **`isDefaultWorkspace()`** (or equivalent check on `WorkspaceInfo.isDefault`), not falsy path.

---

## Gap

1. **No onboarding surface** — first-time users see chat, sidebars, and tools bound to the Minnow repo itself.
2. **Workspace picking is discoverability-heavy** — only via `#btnWorkspace` popover; not a first-run focal point.
3. **Hash routes omit welcome** — no `#/welcome` or boot redirect.
4. **Related polish** — **POLISH-015** (keep top bar on `#/bugs`) implies welcome should **not** hide the entire chrome; prefer a dedicated main region with **top bar visible** (simplified or full), unlike benchmark/bugs which currently hide `header.topbar`.

---

## Goals

1. **First-run clarity:** When `isDefaultWorkspace()` after server sync, user sees workspace home before interacting with chat.
2. **Fast path to project:** One-click **Open folder** and one-click **recent** rows (existing PUT + `applyWorkspaceSwitch`).
3. **Consistent data:** Recents and picker behavior match top-bar workspace menu (no second MRU store).
4. **Stable routing:** `#/welcome` deep-linkable; leaving welcome clears hash to `#/` and shows `#appBody`.
5. **Offline dev:** `npm run dev` (no tool server) shows the same “requires npm start” guidance as workspace menu, not a broken picker.

### Non-goals (v1)

- Clone repository, SSH remote, or multi-root `.code-workspace` files
- Electron / native “empty window” multi-instance (browser tab model only)
- Forcing workspace pick on every launch once user has chosen a non-default path
- Replacing the top-bar workspace popover (welcome **complements** it; long-term may share list renderer)
- Server-side “unset workspace” / null path API (would break `resolveSafePath` assumptions)

---

## Open product decisions (confirm before implementation)

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Should users who **intentionally** work inside the Minnow repo dismiss welcome permanently? | **No v1 flag** — welcome only shows while `isDefault`; picking any folder (including `APP_ROOT` via picker) sets `isDefault: false` only if server treats it as non-default… **Note:** picking the same `APP_ROOT` path still yields `isDefault: true`. Add explicit **“Continue with Minnow folder”** secondary action if dogfooding the app repo must be one click. |
| 2 | Keep full top bar (model picker visible) on welcome? | **Simplified top bar:** brand + Settings only; hide model row and workspace path label until in app (matches Cursor empty window). Aligns with **POLISH-015** direction for global views. |
| 3 | Auto-redirect on boot vs only when hash empty? | **Auto-open welcome** when `isDefault` and hash is `#/` or empty; honor `#/settings`, `#/bugs`, etc. without forcing welcome overlay. |
| 4 | After workspace switch from welcome, restore last chat for that workspace? | **Yes** — call existing `applyWorkspaceScopedSession` via `applyWorkspaceSwitch` (already wired). |

---

## Acceptance criteria

- [ ] After `initApp()` completes workspace sync, if `isDefaultWorkspace()` and hash is not another full-page route, **welcome view is open** and `#appBody` is hidden.
- [ ] **Open folder** opens [`openWorkspaceFolderPicker`](../../../src/ui/workspace-folder-picker.ts) (same as workspace button); successful pick runs `setWorkspacePath` + `applyWorkspaceSwitch`, closes welcome, sets `location.hash` to `#/`.
- [ ] **Recent list** shows `label` + `path` per row; missing folders styled muted with **Remove** (reuse `removeRecentWorkspace`); selecting valid path switches workspace without popover.
- [ ] **Settings** reachable from welcome header (`#/settings/general`); returning from settings with `isDefault` still true re-shows welcome (or stays on settings per hash).
- [ ] **`npm run dev`** without local server: primary actions disabled or show status err consistent with workspace menu (“Workspace requires npm start”).
- [ ] Picking a **non-default** folder sets `isDefault: false`; subsequent reloads **skip** welcome and show chat shell directly.
- [ ] **a11y:** `main` landmark `aria-label="Choose workspace"`; recent list `role="list"`; keyboard activation on rows; Escape does not trap (no modal — full page).
- [ ] **Tests:** Deterministic happy-dom tests with mocked `fetch` for `/api/workspace` (default vs non-default) and hash transitions.
- [ ] **Docs:** `documentation/context.md` workspace section documents welcome route and gate.

---

## Architecture

### Welcome gate (client)

```ts
/** After refreshWorkspaceUi() in initApp */
function shouldShowWelcomeOnBoot(): boolean {
  return isDefaultWorkspace() && !isOtherFullPageHash(window.location.hash);
}
```

`isOtherFullPageHash`: true for `#/settings`, `#/bugs`, `#/benchmark` prefixes.

### New module

Recommended: [`src/ui/welcome-page.ts`](../../../src/ui/welcome-page.ts)

| Export | Responsibility |
|--------|----------------|
| `initWelcomePage()` | Bind controls, `hashchange`, boot check |
| `openWelcome()` | Show `#welcomeView`, hide `#appBody`, set `#/welcome` |
| `closeWelcome()` | Reverse, clear hash to `#/` |
| `isWelcomePageOpen()` | Query `.is-open` on root |

Pattern mirrors [`global-bugs-page.ts`](../../../src/ui/global-bugs-page.ts) but **top bar stays visible** (only hide `.topbar-end` model row via CSS class e.g. `.topbar--welcome`).

### DOM (index.html)

Add sibling to `#globalBugsView` / `#benchmarkView`:

```html
<main id="welcomeView" class="welcome-page" aria-label="Choose workspace" hidden>
  <!-- header actions, tile grid, recent list mount -->
</main>
```

`hidden` or `.is-open` convention should match existing full-page views.

### Hash routing

| Hash | View |
|------|------|
| `#/welcome` | Welcome open |
| `#/` (default) | Chat shell; auto-redirect to welcome when `isDefault` on boot only |
| `#/settings/*` | Settings (close welcome if open) |
| `#/bugs`, `#/benchmark` | Existing behavior |

**Coordination:** Extend `onHashChange` in `settings-page.ts` (and/or central `src/ui/app-routes.ts` if introduced) to close welcome when navigating to peer routes — avoid duplicate listeners fighting (consider single route registry in a follow-up; v1 can chain `closeWelcome()` calls like bugs/settings already do).

### Workspace actions (reuse, do not fork)

| Action | Reuse |
|--------|--------|
| Open folder | `openWorkspaceFolderPicker` + `setWorkspacePath` + `applyWorkspaceSwitch` from [`workspace-button.ts`](../../../src/ui/workspace-button.ts) |
| Recent pick | `setWorkspacePath` + `applyWorkspaceSwitch` (same as [`workspace-recent-menu.ts`](../../../src/ui/workspace-recent-menu.ts) `activateRecent`) |
| Remove recent | `removeRecentWorkspace` |
| List data | `fetchWorkspace()` → `recent` |

Optional refactor (not required v1): extract `renderRecentWorkspaceRows(container, { onSelect, onRemove })` shared by popover and welcome list.

### Boot sequence change ([`main.ts`](../../../src/main.ts))

```
initWorkspaceButton()  → refreshWorkspaceUi()
… other init …
initWelcomePage()
if (shouldShowWelcomeOnBoot()) openWelcome()
else render chat as today
```

Ensure `renderChatFromHistory` still runs (welcome hides shell visually); avoid double-fetch file tree for default workspace if expensive — acceptable v1 cost.

### Styling

New [`src/styles/workspace-welcome-page.css`](../../../src/styles/workspace-welcome-page.css):

- Centered column, max-width ~720px
- Primary tiles: large click targets, bench-instrument borders (see DESIGN.md / workspace-menu)
- Recent rows: two-column name/path; truncate path with `title` full path
- Import in `welcome-page.ts` (same as other full-page modules)

### Server / config

**No API changes required** for v1. Optional later:

- `GET /api/workspace` field `welcomeCompleted: boolean` if product needs “Continue in Minnow folder” without picking a different path.

---

## UI wireframe (logical)

```
┌─────────────────────────────────────────────────────────────┐
│ [logo] Minnow                                    [Settings] │  ← topbar (simplified)
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              Choose a folder to work in                     │
│                                                             │
│   ┌──────────────┐  ┌──────────────┐                        │
│   │ Open folder  │  │ (optional)   │                        │
│   └──────────────┘  └──────────────┘                        │
│                                                             │
│   Recent workspaces                          View all (N)   │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ my-app          C:\Users\...\my-app               │   │
│   │ old-proto       D:\dev\old-proto        [Remove]  │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   (npm run dev: Workspace requires npm start…)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Test plan

| Case | Expectation |
|------|-------------|
| `isDefault: true` on fetch | `openWelcome()` after init; `#appBody` has `hidden` or equivalent |
| `isDefault: false` | Chat shell visible; no welcome |
| `#/welcome` on load with non-default | Close welcome, show shell (invalid deep-link guard) |
| `#/settings/general` on boot + default | Settings opens; welcome not forced on top |
| Recent row click | `fetch` PUT `/api/workspace`, `applyWorkspaceSwitch` called, welcome closed |
| Remove missing recent | DELETE `/api/workspace/recent`, list refresh |

Extend patterns from [`test/ui/workspace-recent-menu.test.mjs`](../../../test/ui/workspace-recent-menu.test.mjs).

---

## Files to touch (implementation checklist)

| File | Change |
|------|--------|
| [`index.html`](../../../index.html) | `#welcomeView` markup |
| [`src/ui/welcome-page.ts`](../../../src/ui/welcome-page.ts) | New module |
| [`src/styles/workspace-welcome-page.css`](../../../src/styles/workspace-welcome-page.css) | New styles |
| [`src/main.ts`](../../../src/main.ts) | `initWelcomePage()`, boot gate |
| [`src/ui/settings-page.ts`](../../../src/ui/settings-page.ts) | Close welcome on settings/bugs hash (import side) |
| [`src/ui/global-bugs-page.ts`](../../../src/ui/global-bugs-page.ts) | Close welcome when opening bugs (optional symmetry) |
| [`src/ui/benchmark-page.ts`](../../../src/ui/benchmark-page.ts) | Close welcome when opening benchmark |
| [`test/ui/welcome-page.test.mjs`](../../../test/ui/welcome-page.test.mjs) | New tests |
| [`documentation/context.md`](../../context.md) | Workspace + routing docs |

---

## Related items

| ID | Relationship |
|----|----------------|
| **POLISH-015** | Top bar visibility on global views — welcome should keep brand/settings visible |
| **POLISH-011** | In-app browser — separate from welcome |
| **BUG-001** | Bugs view first-click flash — unrelated to welcome gate |
| **Feature 04** (workspace root) | MRU + picker already shipped — this polish is UX layer only |
| **POLISH-017+** | Sidebar pins — no dependency |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Flash of chat before welcome | Add `welcome-page` CSS default hidden; open welcome synchronously after first `refreshWorkspaceUi` before paint if needed (`requestAnimationFrame` or boot class on `html`) |
| Hash listener ordering | Explicit `closeWelcome()` in peer `open*` functions |
| User stuck on welcome with broken server | Prominent npm start message; disable picker only, allow Settings |
| Working in Minnow repo (`isDefault` always true) | Ship **Continue with Minnow folder** or document picking parent folder |

---

---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-80](https://linear.app/minnowai/issue/MIN-80/polish-016-workspace-welcome-screen)