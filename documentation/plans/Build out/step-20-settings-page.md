# Step 20 — Full settings page + topbar controls

**Backlog:** [`to-fix.md`](../to-fix.md) items **22** (full settings page), **29** (topbar expert / tool / MCP toggles)  
**Roadmap:** [`to-fix-step-order.md`](../to-fix-step-order.md) — Wave 9 consolidation  
**Depends on:** Steps **01–19** (all prior feature steps must expose stable config APIs and data models)  
**Architecture baseline:** [`documentation/context.md`](../../context.md)

---

## Summary

Replace the narrow **settings drawer** ([`index.html`](../../../index.html) `#drawer`, [`src/ui/settings.ts`](../../../src/ui/settings.ts)) with a **full settings experience** (dedicated route or full-screen panel) that surfaces every SpeedChat configuration surface in one place. Ship the **Full / Lite / Custom** prompting UI with **per-part editors**, **named Custom config save/load**, **topbar quick toggles** (expert, tools, MCP), and **import/export** of the entire `~/.speedchat` home directory. Retire duplicated drawer-only fields where the new page owns them.

This step is **UI + wiring only** for features whose engines were built in Steps 02–19; do not re-implement prompt composition, MCP bridging, or provider logic here.

---

## Prerequisites (must exist before starting)

| Prior step | Required artifacts for Step 20 |
|------------|--------------------------------|
| **02** | `~/.speedchat/` layout, `GET/PUT /api/config/*`, migration from `localStorage` |
| **03** | Provider registry API, secrets in `~/.speedchat/providers/` |
| **04** | `prompt-composer.ts`, part ids, Full/Lite/Custom profiles, `prompt-configs/*.json` CRUD API |
| **05** | Mode enum + files under `src/chat/prompts/modes/` |
| **06** | Expert registry + auto/manual router |
| **07** | Title generation toggle + config flag |
| **08** | Work Agent registry + per-agent model/prompt bindings |
| **09** | Sub-agent settings schema (concurrency, tools, model) |
| **10** | Terminal panel preferences (default open, height) |
| **11** | File tree / viewer preferences (root path, split ratio) |
| **12** | Browser automation toggle + `SPEEDCHAT_BROWSER_URL` |
| **13** | Skills dual-root discovery API |
| **14–15** | Impeccable + UI Designer model binding in config |
| **16** | Memory enable/clear/backup API |
| **17** | `~/.speedchat/lsp.json` + per-server enable flags |
| **18** | MCP registry + Context7 default + tool bridge |
| **19** | Self-healing master toggle |

If any prerequisite API is missing, implement a **minimal read/write stub** in the same PR only when the settings UI cannot function otherwise — document the gap in `documentation/context.md`.

---

## Goals

1. **Single settings hub** — discoverable, navigable, accessible; works on desktop and mobile.
2. **Prompting UX** — profile switcher (Full | Lite | Custom), per-part enable + edit per profile, Custom named configs (load / save / save as / duplicate / delete / new).
3. **Feature sections** — one nav group per major subsystem (see [Settings sections](#settings-sections)).
4. **Topbar quick controls** — expert selector (or deep-link), per-tool toggles, per-MCP-server toggles without opening full settings.
5. **Backup** — export and import full `~/.speedchat` (zip or tar.gz via server); clear warnings on overwrite.
6. **Tests** — integration tests against config APIs + E2E smoke for critical paths.
7. **Docs** — update [`documentation/context.md`](../../context.md); add [`documentation/plans/verification/step-20.md`](../verification/step-20.md).

---

## Non-goals

- Implementing prompt composition logic (Step 04).
- Adding new built-in tools, MCP servers, or providers.
- Changing chat send/stream behavior except where settings must apply immediately (toggles).
- Production hosting of `server.js` (settings still assume `npm start` for full API).

---

## Architecture decisions

### Settings shell: hash route vs full-screen panel

**Recommended:** Hash-based SPA view — `#/settings` and optional `#/settings/prompting` — without adding a router dependency.

| Approach | Pros | Cons |
|----------|------|------|
| **Hash route** (`#/settings`) | No new deps; share `index.html`; back button works with `history` | Slightly less “app-like” URL |
| Full-screen panel (no route) | Minimal DOM change | Harder deep-linking; back button needs custom stack |
| Separate `settings.html` | Clean split | Two bundles; duplicated chrome |

**Implementation sketch:**

- Add `<main id="settingsView" class="settings-page hidden">` sibling to chat layout in [`index.html`](../../../index.html).
- [`src/ui/settings-page.ts`](../../../src/ui/settings-page.ts) — `openSettings(section?)`, `closeSettings()`, `onSettingsRouteChange()`.
- Topbar gear opens settings; **Back to chat** returns to `#/` and shows chat layout.
- Preserve drawer **only** as thin shortcut (optional): gear → full page; or remove drawer entirely in this step (preferred: **remove drawer**, migrate all fields).

### Config access pattern

All reads/writes go through a thin client module — do not scatter `fetch` across section components.

```
src/settings/
  index.ts              # open/close, route, bootstrap
  config-client.ts      # GET/PUT wrappers for ~/.speedchat APIs
  types.ts              # SettingsSectionId, PromptPartId, export manifest types
  sections/             # one module per nav section
  prompting/            # profile tabs, part editors, custom configs
  topbar/               # expert, tool, mcp popovers
  backup.ts             # import/export orchestration
```

Server routes (from Step 02, extend if needed):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | Full `config.json` snapshot |
| PUT | `/api/config` | Partial merge into `config.json` |
| GET | `/api/config/prompt-parts` | Resolved bodies per profile + part |
| PUT | `/api/config/prompt-parts` | Save override for profile + part |
| GET/POST/DELETE | `/api/config/prompt-configs` | Custom named configs |
| GET | `/api/config/providers` | List (no secret values in list) |
| GET/PUT | `/api/config/tools` | Tool enable map + keys |
| GET/PUT | `/api/config/mcp` | MCP server entries + enabled |
| GET/PUT | `/api/config/lsp` | LSP server map |
| POST | `/api/config/export` | Stream zip of `~/.speedchat` |
| POST | `/api/config/import` | Upload zip; optional `?merge=true` |

### Prompt part ids (canonical)

Align with Step 04 — do not invent new ids in UI only:

`base` | `mode` | `expert` | `tool-usage` | `info` | `memory` | `work-agent` | `skill`

### Active profile storage

`~/.speedchat/config.json`:

```json
{
  "promptProfile": "full",
  "activePromptConfigId": "my-debug-setup",
  "features": {
    "memoryInjection": true,
    "expertLayer": true,
    "modeLayer": true,
    "toolUsageBlock": true,
    "programmaticTitles": true,
    "workAgentPrompts": true,
    "skillInjection": true,
    "selfHealing": false,
    "subAgents": true,
    "mcpContext": true,
    "lspContext": true
  }
}
```

Custom profile uses `activePromptConfigId` + `prompt-configs/<id>.json` for per-part enable/override.

---

## UI specification

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to chat    Settings                    [Export][Import]│
├──────────────┬──────────────────────────────────────────────┤
│ Nav (240px)  │ Section content (scroll)                      │
│ · General    │                                               │
│ · Prompting  │  [section-specific fields]                    │
│ · Providers  │                                               │
│ · …          │                                               │
└──────────────┴──────────────────────────────────────────────┘
```

- **Mobile:** nav becomes horizontal scroll chips or `<select>` at top; content full width.
- **A11y:** `role="navigation"` for nav; `aria-current="page"` on active section; focus trap only in modals (import confirm), not whole page.
- **Design:** Reuse tokens from [`DESIGN.md`](../../../DESIGN.md) / [`src/styles/tokens.css`](../../../src/styles/tokens.css); new [`src/styles/settings-page.css`](../../../src/styles/settings-page.css).

### Prompting section (required — highest complexity)

**Row 1 — Profile segmented control**

```
[ Full ] [ Lite ] [ Custom ]
```

- Changing profile updates `config.promptProfile` immediately (debounced save).
- **Full / Lite:** part editors show overrides for `~/.speedchat/prompts/overrides/full/` and `.../lite/` respectively; fall back to shipped `src/chat/prompts/` / `liteBody`.
- **Custom:** show config selector + part editors bound to active named config.

**Row 2 — Custom config toolbar** (visible only when profile = Custom)

| Control | Action |
|---------|--------|
| Dropdown | Load saved config (`listPromptConfigs`) |
| New | Create empty config with default part map |
| Save | Persist current editor state to active id |
| Save as… | Prompt for label → new id |
| Duplicate | Copy active → new id |
| Delete | Confirm → remove file |

**Row 3 — Per-part accordion** (all profiles)

For each `PromptPartId`:

| Control | Behavior |
|---------|----------|
| Enable toggle | `parts[part].enabled`; disabled parts gray out editor |
| Editor | `<textarea>` or optional CodeMirror later; shows **resolved** text for active profile |
| Reset | Delete override file for this part + profile; reload shipped default |
| Token estimate | Optional read-only char count (no dynamic token API required v1) |
| Open file | Link opens path hint in UI (server cannot open OS editor; show copy path) |

**Dirty state:** Warn on section change or Back if unsaved edits (`beforeunload` optional).

**Feature master toggles** (subsection below parts):

Map to `config.features.*` — disabling a feature should disable related parts in composer (Step 04 hook), not only hide UI.

### Settings sections

| Section id | Title | Primary controls |
|------------|-------|------------------|
| `general` | General | LM Studio / default provider pick, temperature, max tokens, theme (if any), clear chat shortcut |
| `prompting` | Prompting | Full/Lite/Custom UI (above), feature master toggles, legacy preset migration notice |
| `providers` | Providers | CRUD list, base URL, auth type, API key (masked), test connection |
| `modes` | Modes | Default mode; link to edit mode prompt files (per profile tab) |
| `experts` | Experts | Enable auto-assign; default manual expert; list experts with enable |
| `work-agents` | Work Agents | List agents; model/provider per agent; open prompt editor (per profile) |
| `sub-agents` | Sub-agents | Max concurrent; per-type model; allowed tools multiselect |
| `tools` | Tools | Reuse [`fillToolsSection`](../../../src/ui/settings.ts) pattern; Brave key; server banner |
| `mcp` | MCP servers | List servers; enable toggle; Context7 key; add custom server form |
| `lsp` | LSP | Master enable; per-server toggle from OpenCode catalog; add custom server |
| `memory` | Memory | Enable injection; clear; backup/restore memory dir |
| `skills` | Skills | Built-in vs user paths; rescan; open `~/.speedchat/skills` hint |
| `terminal` | Terminal | Default panel height; auto-open on command |
| `files` | Files & workspace | Default cwd; file tree root; split ratio |
| `browser` | Browser automation | Enable CDP tools; allowed origins; `SPEEDCHAT_BROWSER_URL` |
| `ui-designer` | UI Designer | Provider + model for designer agent |
| `self-healing` | Self-healing | Master toggle; tier-2 approval policy (if Step 19 exposes) |
| `backup` | Backup & data | Export / import `~/.speedchat`; show home path; migration status |

**Migrate from drawer:** Move `#serverUrl`, `#temperature`, `#maxTokens`, system prompt preset UI, and tools section into appropriate sections; remove duplicate markup from drawer or delete drawer DOM.

### Topbar quick controls (backlog 30)

Add to [`index.html`](../../../index.html) header (after model select, before settings gear):

```
[ Expert ▾ ] [ Tools ▾ ] [ MCP ▾ ]  …  [ Settings ]
```

| Button | Popover content |
|--------|-----------------|
| **Expert** | Auto + expert list (mirror Step 06 chat dropdown or relocate here — pick **one** canonical control; topbar is quick access) |
| **Tools** | Search/filter + checkbox per tool (reuse `onToolToggle` from [`src/tools/config.ts`](../../../src/tools/config.ts)); group by category |
| **MCP** | Checkbox per configured server; Context7 pinned top |

**Behavior:**

- Popovers close on Escape / outside click; `aria-expanded` on trigger.
- Changes persist via same APIs as full settings (single source of truth).
- Server-required tools: same dim/disable rules as drawer when ping fails.
- **Link:** “All settings…” footer in each popover → `#/settings/tools` etc.

**Do not** duplicate expert dropdown in composer **and** topbar without sync — use shared state module `src/settings/quick-toggles.ts`.

### Import / export

**Export**

1. User clicks Export → confirm → `POST /api/config/export`.
2. Server builds zip of `~/.speedchat` excluding transient logs > optional size cap.
3. Browser downloads `speedchat-backup-YYYY-MM-DD.zip`.

**Import**

1. User selects file → modal: **Replace all** vs **Merge** (merge skips conflicting secrets if checkbox).
2. `POST /api/config/import` with multipart body.
3. On success: toast + reload config client + re-render settings; optional full page reload.
4. On failure: show server error string; do not partial-corrupt (atomic replace via temp dir).

**Security**

- Path traversal rejected on import entries.
- Never include `.env` from repo — only home dir.
- Warn that import may overwrite API keys.

---

## Implementation phases

### Phase A — Shell and routing

- [ ] Add `settings-page` markup and CSS; hide chat layout when settings open.
- [ ] Implement `openSettings` / `closeSettings` / hash sync.
- [ ] Wire topbar gear to open settings (remove or deprecate `toggleDrawer`).
- [ ] Section nav + lazy render section modules on first visit.

### Phase B — Config client

- [ ] `config-client.ts` with typed responses and error handling.
- [ ] Load full config on settings open; cache in memory; debounced PUT per section.
- [ ] `settings/types.ts` mirrors server schemas from Steps 02–19.

### Phase C — Prompting UI

- [ ] Profile segmented control + save `promptProfile`.
- [ ] Custom config toolbar + CRUD wired to `/api/config/prompt-configs`.
- [ ] Per-part accordion: load/save/reset per profile.
- [ ] Feature master toggles subsection.
- [ ] Remove legacy `SYSTEM_PROMPT_PRESETS` single textarea as primary UX (optional: move presets under `info` part or General).

### Phase D — Feature sections

- [ ] Implement each section module (table above); extract shared `Field`, `ToggleRow`, `SectionHeader` components in `src/settings/components/`.
- [ ] Port tools UI from [`src/ui/settings.ts`](../../../src/ui/settings.ts) → `sections/tools.ts`.
- [ ] Providers, MCP, LSP: forms with validation (required URL, command array for LSP).

### Phase E — Topbar popovers

- [ ] `src/settings/topbar/expert-popover.ts`
- [ ] `src/settings/topbar/tools-popover.ts`
- [ ] `src/settings/topbar/mcp-popover.ts`
- [ ] Shared popover primitive (position, focus, Escape).

### Phase F — Backup

- [ ] Server export/import handlers (if not from Step 02).
- [ ] `sections/backup.ts` UI + modals.

### Phase G — Cleanup and docs

- [ ] Remove drawer DOM and dead code in `settings.ts` (keep shared helpers or move to `sections/`).
- [ ] Update [`src/main.ts`](../../../src/main.ts) bootstrap: register settings routes, drop drawer init if removed.
- [ ] Update [`documentation/context.md`](../../context.md) — settings page, topbar toggles, backup paths.
- [ ] Add verification doc with commands.

### Phase H — Tests

See [Testing plan](#testing-plan).

---

## File change map

| File | Action |
|------|--------|
| `index.html` | Add `#settingsView`; topbar popover anchors; remove/minimize `#drawer` |
| `src/main.ts` | Import settings bootstrap; hash listener |
| `src/ui/settings.ts` | Split: drawer removed; migrate tools/prompt helpers to `src/settings/` |
| `src/styles/settings.css` | Drawer styles deprecated → `settings-page.css` |
| `src/styles/settings-page.css` | **New** — full page layout |
| `src/styles/topbar.css` | Popover positioning |
| `src/settings/**` | **New** tree |
| `server.js` | Export/import endpoints if missing |
| `documentation/context.md` | Settings + backup + topbar |
| `documentation/plans/verification/step-20.md` | **New** |
| `test/integration/step-20-settings.test.mjs` | **New** |
| `test/e2e/step-20-settings.spec.mjs` | **New** (optional Playwright) |

---

## Integration points

| Module | Integration |
|--------|-------------|
| [`src/tools/config.ts`](../../../src/tools/config.ts) | Tool toggles read/write `~/.speedchat` via API; topbar + settings share `onToolToggle` |
| [`src/tools/client.ts`](../../../src/tools/client.ts) | `getEnabledToolDefinitions()` reacts to toggle changes without reload |
| Step 04 composer | Listens to `promptProfile`, `features`, active custom config |
| [`src/api/models.ts`](../../../src/api/models.ts) | Provider switch in General/Providers refreshes model list |
| [`src/state/sessions.ts`](../../../src/state/sessions.ts) | Unchanged; sessions live under `~/.speedchat/sessions/` |
| Chat UI | Mode selector stays near composer (Step 05); settings links to Modes section |

---

## Testing plan

### Integration tests (`test/integration/step-20-settings.test.mjs`)

Run with `npm start` and a temp `SPEEDCHAT_HOME` env pointing at a fixture dir.

| # | Test | Expected |
|---|------|----------|
| 1 | GET `/api/config` | 200 + `promptProfile` field |
| 2 | PUT `promptProfile: lite` | Persists; GET returns `lite` |
| 3 | POST prompt-config create | File appears under `prompt-configs/` |
| 4 | PUT prompt-part override | Override file written for `full` + `base` |
| 5 | Reset prompt-part | Override removed; GET returns shipped default substring |
| 6 | PUT tools enabled map | `web_search` false → GET reflects |
| 7 | PUT MCP server enabled | Context7 disabled flag persists |
| 8 | POST export | Zip contains `config.json`, `prompt-configs/` |
| 9 | POST import merge | New keys merged; existing keys optional preserve |
| 10 | Import path traversal | Rejects `../` entries with 400 |

Use **fixed ids** in fixtures: `11111111-1111-1111-1111-111111111111` for config ids; **static expected JSON strings** for assertions.

### E2E smoke (`test/e2e/step-20-settings.spec.mjs`)

Use Playwright or `agent-browser` skill against `http://localhost:5173`.

| # | Flow |
|---|------|
| 1 | Open `#/settings` → Prompting visible |
| 2 | Switch Full → Lite → editor content changes (fixture override) |
| 3 | Custom: Save as new config → reload page → config still selected |
| 4 | Topbar Tools popover → toggle one tool → send path includes/excludes tool (mock LM Studio) |
| 5 | Topbar MCP popover → disable server → reflected in settings MCP section |
| 6 | Export downloads file; file size > 0 |
| 7 | Back to chat → chat layout visible; settings hidden |

### Manual verifier checklist

Document in `documentation/plans/verification/step-20.md`:

- [ ] Keyboard: Tab through nav; Escape closes popovers not settings page
- [ ] Mobile width: nav usable; no horizontal overflow
- [ ] `npm run dev`: settings read-only or banner “Start npm start to save”
- [ ] Server offline: tool/MCP toggles show same banners as today
- [ ] Import replace on production-like home dir (user confirms on copy)

---

## Acceptance criteria

1. Settings gear opens **full settings page**, not drawer-only UX.
2. **Full / Lite / Custom** profile switch works; each part editable per profile with enable/disable and reset.
3. **Custom** configs: load, save, save as, duplicate, delete, new.
4. All sections in [Settings sections](#settings-sections) are present and persist via `~/.speedchat` APIs.
5. Topbar **Expert**, **Tools**, **MCP** popovers work and stay in sync with settings page.
6. **Export** and **import** round-trip `config.json` + `prompt-configs/` on a fixture home dir.
7. Integration tests pass in CI script (add `npm test` if Step 02 introduced it).
8. [`documentation/context.md`](../../context.md) updated.
9. No regression: chat send, tool loop, sidebar, attachments (smoke from [`tool-usage-verification.md`](../tool-usage-verification.md)).

---

## Sub-agent handoff (implementer)

1. Read this plan + [`to-fix-step-order.md`](../to-fix-step-order.md) Step 20 + [`context.md`](../../context.md).
2. Audit Steps 02–19 APIs — list gaps before UI work.
3. Execute phases **A → H** in order; check off todos below.
4. Write tests in Phase H before declaring done.
5. Update `context.md` and create `verification/step-20.md`.

**Verifier agent:** Re-run `npm run build`, integration tests, E2E smoke; execute manual checklist; PASS/FAIL only.

---

## Master todo list

### Planning and audit

- [ ] **T01** Confirm Steps 01–19 merged; inventory existing `/api/config/*` routes in `server.js`
- [ ] **T02** List missing APIs; open minimal server stubs if blocking
- [ ] **T03** Agree hash-route approach with parent agent (no extra router dep)

### Phase A — Shell

- [ ] **T04** Add `#settingsView` markup to `index.html`
- [ ] **T05** Create `src/settings/index.ts` — open/close, hash routing
- [ ] **T06** Create `src/styles/settings-page.css` — layout, nav, responsive
- [ ] **T07** Wire `#btnSettings` → `openSettings()`; add Back to chat control
- [ ] **T08** Section nav component with `aria-current` and deep links (`#/settings/tools`)

### Phase B — Config client

- [ ] **T09** Create `src/settings/types.ts`
- [ ] **T10** Create `src/settings/config-client.ts` — getConfig, patchConfig, error toasts
- [ ] **T11** Debounced save helper (300ms) shared across sections
- [ ] **T12** Server: ensure GET/PUT `/api/config` supports `promptProfile`, `features`, `activePromptConfigId`

### Phase C — Prompting

- [ ] **T13** Create `src/settings/prompting/profile-switcher.ts`
- [ ] **T14** Create `src/settings/prompting/custom-config-toolbar.ts` — CRUD UI
- [ ] **T15** Create `src/settings/prompting/part-editor.ts` — accordion per part id
- [ ] **T16** Wire load/save/reset to `/api/config/prompt-parts` and prompt-configs API
- [ ] **T17** Feature master toggles UI → `config.features`
- [ ] **T18** Migrate off drawer system prompt preset UX (deprecate or relocate presets)

### Phase D — Sections

- [ ] **T19** `sections/general.ts` — server URL / provider, temperature, max tokens
- [ ] **T20** `sections/providers.ts` — provider CRUD forms
- [ ] **T21** `sections/modes.ts` — default mode + links to prompt parts
- [ ] **T22** `sections/experts.ts` — auto/manual defaults
- [ ] **T23** `sections/work-agents.ts` — list + model + prompt link
- [ ] **T24** `sections/sub-agents.ts` — concurrency + tool allowlist
- [ ] **T25** `sections/tools.ts` — port from `fillToolsSection` + Brave key
- [ ] **T26** `sections/mcp.ts` — server list + Context7 + add custom
- [ ] **T27** `sections/lsp.ts` — catalog toggles + custom server form
- [ ] **T28** `sections/memory.ts` — enable, clear, backup
- [ ] **T29** `sections/skills.ts` — paths + rescan
- [ ] **T30** `sections/terminal.ts` — panel prefs
- [ ] **T31** `sections/files.ts` — cwd + tree prefs
- [ ] **T32** `sections/browser.ts` — CDP toggle + URL
- [ ] **T33** `sections/ui-designer.ts` — model binding
- [ ] **T34** `sections/self-healing.ts` — master toggle
- [ ] **T35** `sections/backup.ts` — export/import UI
- [ ] **T36** Shared components: `SectionHeader`, `ToggleRow`, `Field`, `SaveIndicator`

### Phase E — Topbar

- [ ] **T37** Create `src/settings/topbar/popover.ts` primitive
- [ ] **T38** Expert popover + sync with Step 06 state
- [ ] **T39** Tools popover + category groups + server banner
- [ ] **T40** MCP popover + enable toggles
- [ ] **T41** Update `src/styles/topbar.css` for popover layout
- [ ] **T42** Add topbar buttons to `index.html`

### Phase F — Backup

- [ ] **T43** Server: `POST /api/config/export` (zip stream)
- [ ] **T44** Server: `POST /api/config/import` (atomic replace + merge mode)
- [ ] **T45** Client: download/upload + confirm modals

### Phase G — Cleanup

- [ ] **T46** Remove settings drawer from `index.html` (or hide permanently)
- [ ] **T47** Refactor `src/ui/settings.ts` — delete dead drawer code; re-export moved helpers
- [ ] **T48** Update `src/main.ts` init order
- [ ] **T49** Update `documentation/context.md`
- [ ] **T50** Create `documentation/plans/verification/step-20.md`

### Phase H — Tests

- [ ] **T51** Fixture dir `test/fixtures/speedchat-home/` with static config
- [ ] **T52** `test/integration/step-20-settings.test.mjs` (cases 1–10)
- [ ] **T53** `test/e2e/step-20-settings.spec.mjs` (flows 1–7)
- [ ] **T54** Add `npm test` script if absent — runs integration tests against `npm start`
- [ ] **T55** Verifier PASS recorded in `verification/step-20.md`

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Step 04 APIs not ready | Stub read/write; feature-flag prompting section |
| Drawer removal breaks `initApp` | Keep no-op `toggleDrawer` shim one release |
| Import overwrites user data | Strong confirm + default to merge; backup timestamp in filename |
| Topbar overcrowded | `mid-hide` CSS hide expert on narrow widths; keep in settings |
| Large prompt bodies slow UI | Virtualize or collapse parts by default; load part body on expand only |

---

## References

- [`documentation/plans/to-fix.md`](../to-fix.md) — backlog 23, 30
- [`documentation/plans/to-fix-step-order.md`](../to-fix-step-order.md) — Step 20 wave
- [`PRODUCT.md`](../../../PRODUCT.md) — settings as familiar pattern
- [`src/ui/settings.ts`](../../../src/ui/settings.ts) — current drawer implementation
- [`src/tools/config.ts`](../../../src/tools/config.ts) — tool toggle persistence pattern to mirror for MCP

---

## Changelog

| Date | Author | Note |
|------|--------|------|
| 2026-05-19 | Implementer plan | Initial Step 20 build plan |
