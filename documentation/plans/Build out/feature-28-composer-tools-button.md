# Feature 28 — Composer tools button (F5)

**Backlog ID:** F5 · `feature-28-composer-tools-button`  
**Wave:** 4 (Settings completeness)  
**Size:** M  
**Status:** Implemented

---

## 1. Problem

Tool permissions are only editable in two places today:

| Surface | Container | Builder |
|--------|-----------|---------|
| Settings drawer | `#toolsList` | `fillToolsSection()` in [`src/ui/settings.ts`](../../../src/ui/settings.ts) |
| Full settings page → Tools | `#settingsToolsList` | `renderToolsSection()` → `fillToolsSection('settingsToolsList')` in [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) |

The chat **composer** (`#composerControls` + `.input-row` in [`index.html`](../../../index.html)) has mode, expert, attach, and send — but no quick way to enable/disable tools or switch **off / ask / full** without opening Settings.

Users mid-conversation need Cursor-like access: a **tools** control beside the input that opens a popover with the same permission matrix and persists to `~/.minnow/tools.json` (or `minnow.tools` in Vite-only mode) via existing [`saveToolConfig`](../../../src/tools/config.ts).

---

## 2. Goal (from product backlog F5)

Backlog ([`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § F5):

> Icon button in composer toolbar opens popover: all tools with **off/ask/full** toggles (reuse `fillToolsSection` logic); syncs `tools.json`.

**Interpretation:** “Composer toolbar” = `.input-row` beside `#attachBtn` (not `#composerControls`, which is mode/expert only).

Deliverables:

- Add an **icon button** in the composer input row.
- Click opens a **popover** listing all built-in tools with **off / ask / full** controls (same semantics as Settings).
- Changes **sync immediately** with drawer + settings page and persist through the existing config pipeline (`PUT /api/config/tools` or `localStorage`).

**Out of scope for this feature**

- Brave API key editing (stay on Settings → Tools only; popover may link there).
- Filesystem access radios (`toolSecurity.filesystemAccess`) — settings page only.
- F6 “All full permissions” bulk action ([`feature-29-all-full-permissions`](feature-29-all-full-permissions.md)) — separate button on settings page; optional footer link in popover only.
- MCP server toggles (not in `fillToolsSection` today).

---

## 3. Current architecture (research summary)

### 3.1 DOM builder — `fillToolsSection(containerId)`

[`fillToolsSection`](../../../src/ui/settings.ts) (lines ~333–416):

- Clears container, appends global **Enable all tools** toolbar (`createToolSelectAllControl`).
- Iterates `TOOL_CATEGORY_ORDER` (8 categories: web, utility, browser, agents, lsp, files, git, code).
- Per tool: row with `data-tool-id`, label, `<select class="tool-permission-select">` (off / ask / full), description `<p class="tool-desc">`.
- Browser category gets extra hint paragraph.
- Calls `bindToolsListChange(container)` once per list (delegated `change` → `setToolPermission` / `setToolsEnabled`).

Handlers live in the same file; [`registerToolHandlers`](../../../src/ui/settings.ts) binds `#toolsList` and `#settingsToolsList` at init (one-shot guard).

### 3.2 Config persistence

- Shape: `enabled`, `permissions`, `keys` — documented in [`documentation/context.md`](../../context.md) § `minnow.tools`.
- Writes: `setToolPermission` / `setToolsEnabled` → `saveToolConfig` → `putTools` or `localStorage`.
- Hydration: `loadToolConfigIntoDrawer(root)` sets each select from `getToolPermissionForId`.
- Server tools: `refreshServerToolDisabledState()` dims rows when `detectLocalServer()` fails; updates `#toolsServerBanner` and `#settingsToolsServerBanner`.

### 3.3 Multi-list sync gap (must fix in this feature)

`setToolPermission(id, mode, root)` and `setToolsEnabled(..., root)` only call `loadToolConfigIntoDrawer(root)` for the **list that fired the event**. Changing a permission in the drawer does **not** update `#settingsToolsList` selects until the user re-opens that section (and vice versa).

**Requirement for feature 28:** any permission change from **any** surface (drawer, settings page, composer popover) must refresh **all mounted** tool lists.

Recommended fix (implement as part of this feature):

```ts
// src/tools/config.ts (new)
export function refreshAllToolListUis(): void {
  loadToolConfigIntoDrawer(document);
  syncToolSelectAllControls(document);
}
```

Then replace trailing `loadToolConfigIntoDrawer(root)` / `syncToolSelectAllControls(root)` in `setToolPermission`, `setToolsEnabled`, and ensure `refreshServerToolDisabledState` ends with `refreshAllToolListUis()` instead of ad hoc document + settingsList calls.

### 3.4 Composer layout (insertion point)

From [`index.html`](../../../index.html) (~427–463):

```
.input-bar
  .input-bar-composer
    #composerControls     ← mode segmented, expert, work-agent dev
    #attachPreview
    .input-row
      #attachBtn
      .input-wrap (#msgInput, #skillPicker)
  #sendBtn
```

**Recommended placement:** new `#btnComposerTools` in `.input-row`, **between** `#attachBtn` and `.input-wrap` — matches Cursor-style “tools near the message field,” same 44×44 control size as attach ([`src/styles/input.css`](../../../src/styles/input.css)).

**Alternative (reject unless UX review says otherwise):** inside `#composerControls` — competes for width with mode + expert on narrow screens (`composer-controls` already wraps at 600px).

### 3.5 Popover pattern precedent

[`src/ui/skill-picker.ts`](../../../src/ui/skill-picker.ts): programmatic panel anchored under `.input-wrap`, `hidden` class toggle, keyboard navigation, click-outside close. Reuse the same **anchoring parent** (`.input-wrap` or `.input-bar-composer`) and z-index stacking conventions from [`src/styles/skill-picker.css`](../../../src/styles/skill-picker.css).

Prefer **native popover API** only if already used elsewhere in Minnow; otherwise stick to positioned `div` + `hidden` for consistency with skill picker.

### 3.6 `src/ui/input.ts` (not the toolbar owner)

[`src/ui/input.ts`](../../../src/ui/input.ts) only handles composer **input behavior**: `autoResize`, `handleKey` (Enter → `sendMessage`, skill-picker guard), `setSendLoading` / `scrollBottom`. Markup for attach/send lives in [`index.html`](../../../index.html); **no change required** in `input.ts` for feature 28 unless UX wants Enter suppressed while the tools popover is open (optional mirror of `isSkillPickerOpen()` in `handleKey`).

### 3.7 `tools.json` sync (unchanged pipeline)

| Step | Location |
|------|----------|
| User changes `<select>` | `handleToolsListChange` → `setToolPermission` / `setToolsEnabled` |
| Persist | `saveToolConfig` → `putTools` (`PUT /api/config/tools`) when `isServerStorageMode()`, else `localStorage` `minnow.tools` |
| Model request | `getEnabledToolDefinitions()` reads `cachedConfig` after `ensureToolConfigReady()` |

Composer popover uses the **same handlers**; no new API routes or schema fields.

---

## 4. Proposed UX

### 4.1 Composer button

| Property | Value |
|----------|--------|
| Element | `<button type="button" id="btnComposerTools" class="composer-tools-btn">` |
| Icon | Wrench / sliders / toolkit SVG (match `.attach-btn` `.icon-svg` 20px) |
| `aria-label` | `Tools` |
| `aria-expanded` | `false` / `true` when popover open |
| `aria-controls` | `composerToolsPopover` |
| Disabled when | Optional: same as attach during tool-approval pending (`main-column--tool-approval-pending` hides `.input-bar` today — button hidden with composer) |

**Optional enhancement (stretch):** small pill on the button showing count of tools where permission ≠ `off` (e.g. `12`). Not required for acceptance.

### 4.2 Popover panel

| Property | Value |
|----------|--------|
| Container | `#composerToolsPopover` — `role="dialog"` + `aria-label="Tool permissions"` |
| List host | `#composerToolsList` with class `tools-list tools-list--composer` |
| Position | Above button, right-aligned on desktop; flip above input on mobile if overflow |
| Max size | `max-height: min(60vh, 420px)`, `overflow-y: auto` |
| Content | Call `fillToolsSection('composerToolsList', { variant: 'composer' })` after refactor (see §5) |
| Header | One-line hint: “Server tools need npm start” — reuse banner styling when offline (`tools-server-banner` compact) |
| Footer | Text link: “Open Settings → Tools” → `navigateSettingsSection('tools')` or open drawer Tools section |

**Compact variant (`composer`):**

- Keep permission `<select>` and bulk **Enable all** / per-category **All** checkboxes (parity with settings).
- **Hide** `.tool-desc` paragraphs to save vertical space (labels + selects only).
- Keep category headers and browser hint (short).

### 4.3 Interaction

| Action | Behavior |
|--------|----------|
| Click button | Toggle popover; focus first focusable control inside |
| Click outside | Close popover; return focus to button |
| `Escape` | Close popover |
| Change permission | Same as settings: persist + `refreshAllToolListUis()` |
| Open settings drawer Tools while popover open | Both stay consistent via shared refresh |
| `npm run dev` (no server) | Server-required rows disabled; banner visible in popover |

---

## 5. Implementation design

### 5.1 Refactor tool list DOM (avoid duplication)

Extract from `settings.ts` into **`src/ui/tools-list.ts`** (name flexible):

| Export | Responsibility |
|--------|----------------|
| `fillToolsSection(containerId, options?)` | Build DOM (move `TOOL_CATEGORY_*`, `createToolSelectAllControl`, loop) |
| `bindToolsListChange(list)` | Delegated change handler (move `handleToolsListChange`) |
| `registerToolHandlers()` | Bind all known list roots |

`options.variant`: `'default' | 'composer'` — controls desc visibility and optional extra classes.

Update imports in:

- `src/ui/settings.ts` (re-export or thin wrapper for backward compat if globals reference `fillToolsSection` from bundle)
- `src/ui/settings-sections.ts`
- `src/main.ts`

### 5.2 New module — `src/ui/composer-tools-popover.ts`

| Function | Responsibility |
|----------|----------------|
| `initComposerToolsPopover()` | Create button + popover DOM if not in HTML; or wire static markup from `index.html` |
| `openComposerToolsPopover()` / `closeComposerToolsPopover()` | Toggle classes, `aria-expanded`, populate list on first open |
| `isComposerToolsPopoverOpen()` | For tests / outside click |

Call from `initApp()` in [`src/main.ts`](../../../src/main.ts) after `fillToolsSection('toolsList')` and `registerToolHandlers()`:

```ts
fillToolsSection('composerToolsList', { variant: 'composer' });
initComposerToolsPopover();
registerToolHandlers(); // extend to bind #composerToolsList
```

On first open, `loadToolConfigIntoDrawer(document)` ensures selects match cache even if config loaded before popover mount.

### 5.3 Global UI refresh

Implement `refreshAllToolListUis()` in [`src/tools/config.ts`](../../../src/tools/config.ts) and use it from `setToolPermission`, `setToolsEnabled`, and `refreshServerToolDisabledState`.

### 5.4 HTML/CSS changes

**[`index.html`](../../../index.html)** — inside `.input-row` after attach button:

```html
<button type="button" class="composer-tools-btn" id="btnComposerTools"
  aria-label="Tools" aria-expanded="false" aria-haspopup="dialog"
  aria-controls="composerToolsPopover">
  <!-- toolkit SVG -->
</button>
<div id="composerToolsPopover" class="composer-tools-popover hidden" role="dialog" aria-label="Tool permissions">
  <p id="composerToolsServerBanner" class="tools-server-banner hidden" role="status">…</p>
  <div id="composerToolsList" class="tools-list tools-list--composer"></div>
  <footer class="composer-tools-popover__footer">
    <button type="button" class="composer-tools-popover__link" id="composerToolsOpenSettings">Settings → Tools</button>
  </footer>
</div>
```

Alternatively mount popover entirely from TS (like skill picker) to keep `index.html` smaller — document choice in PR.

**New stylesheet:** `src/styles/composer-tools-popover.css` — import in `main.ts`.

- `.composer-tools-btn` — mirror `.attach-btn` dimensions/states.
- `.composer-tools-popover` — absolute/fixed positioning, shadow, border, z-index above chat content, below modals if any.
- `.tools-list--composer .tool-desc { display: none; }`
- `.tools-list--composer .tool-row` — tighter padding.

Extend `refreshServerToolDisabledState` to toggle `#composerToolsServerBanner` alongside existing banners.

---

## 6. Exact file change list

| File | Change |
|------|--------|
| `documentation/plans/Build out/feature-28-composer-tools-button.md` | This plan |
| `documentation/plans/verification/feature-28.md` | Plan/sign-off checklist (pre-ship: plan QA; post-ship: implementation) |
| `documentation/context.md` | After ship: document composer tools button + popover under Tools UI |
| `index.html` | Composer tools button + popover shell (if not fully TS-mounted) |
| `src/ui/tools-list.ts` | **New** — extracted `fillToolsSection`, handlers, category constants |
| `src/ui/settings.ts` | Remove moved code; re-export or delegate to `tools-list.ts` |
| `src/ui/composer-tools-popover.ts` | **New** — open/close, outside click, settings link |
| `src/tools/config.ts` | `refreshAllToolListUis()`; wire into setters + server refresh |
| `src/ui/settings-sections.ts` | Import `fillToolsSection` from `tools-list.ts` |
| `src/main.ts` | Import CSS + `initComposerToolsPopover()`; fill composer list at boot |
| `src/styles/composer-tools-popover.css` | **New** — button + popover + compact list |
| `src/styles/input.css` | Optional: `.input-row` gap tweak for third button |
| `test/tools/tools-list-sync.test.mts` | **New** (optional) — jsdom: two lists, change one, assert other select value |

No server/API/schema changes.

---

## 7. Schema / API / migration

| Area | Change |
|------|--------|
| `tools.json` / `PUT /api/config/tools` | None |
| `config.json` | None |
| `BUILT_IN_TOOLS` catalog | None |
| Migration | None |

---

## 8. Acceptance criteria

Copy from backlog, extended:

1. **Visibility:** A tools icon button appears in the composer input row (adjacent to attach), visible on desktop and mobile layouts.
2. **Popover:** Clicking toggles a panel listing **all** built-in tools grouped by category with **off / ask / full** selects matching Settings labels.
3. **Persistence:** Changing any tool writes the same config as Settings (`permissions` + mirrored `enabled`); survives reload under `npm start` and Vite `localStorage` mode.
4. **Sync:** Changing a tool in the popover updates drawer `#toolsList` and settings `#settingsToolsList` without reload; reverse direction also holds.
5. **Bulk controls:** Global “Enable all tools” and per-category “All” checkboxes work in the popover (bulk sets ask/off per existing logic).
6. **Server gating:** When local tool server is down, server-required tools are disabled in the popover; compact banner explains `npm start`.
7. **Accessibility:** Button has `aria-expanded`; popover is keyboard-dismissible (`Escape`); focus returns to button on close.
8. **Settings link:** Footer control navigates user to full Tools settings (drawer section or settings page — pick one implementation, document in PR).
9. **No regression:** `registerToolHandlers`, tool approval flow, and `getEnabledToolDefinitions()` behavior unchanged aside from multi-list refresh.

---

## 9. Test plan

### 9.1 Automated

| Command | Expectation |
|---------|-------------|
| `npm test` | All existing tests pass |
| `test/tools/tools-list-sync.test.mts` (if added) | Changing permission via handler updates two detached lists in jsdom |

No new server tests required.

### 9.2 Manual QA (`npm start`)

1. Open app → composer shows tools button next to paperclip.
2. Open popover → ~40 tools in 8 categories; descriptions hidden; selects match drawer.
3. Set `read_file` → **Full permission** → send message that triggers read → no approval modal (workspace path).
4. Set same tool → **Requires permission** → approval strip appears on use.
5. Set → **Disabled** → tool absent from model request (verify via network payload or behavior).
6. With server stopped (`npm run dev` or stop server): server tools disabled + banner in popover; enabling shows status error.
7. Change tool in popover → open Settings drawer Tools → same select value.
8. Change tool in full Settings page → reopen popover → value matches.
9. Reload page → permissions preserved.
10. Mobile width ≤600px: popover scrolls, does not cover send button permanently.
11. Tool approval pending: composer hidden — tools button not interactable (inherits `.input-bar` hide).

### 9.3 Manual QA (Vite-only)

1. `npm run dev` → permissions persist to `localStorage`; popover still functions for browser-native tools.

---

## 10. Dependencies and coordination

| Relation | Notes |
|----------|--------|
| **Depends on** | Existing tool permission system (shipped) |
| **Blocks** | None |
| **Parallel with** | F6 `feature-29-all-full-permissions` (different UI; share `refreshAllToolListUis`) |
| **After** | Optional: F4 token estimate may count enabled tools — no hard dependency |

---

## 11. Open questions (resolve during implementation)

1. **HTML vs TS mount:** Static markup in `index.html` vs pure `initComposerToolsPopover()` DOM creation — prefer TS-only if skill-picker pattern is the team default.
2. **Settings deep link:** Footer opens **drawer** Tools section vs **full settings page** `#tools` — full page is richer (filesystem radios); recommend `initSettingsPage` navigation if settings view is already in DOM.
3. **Enabled-count badge:** Ship in v1 or defer?
4. **Popover width:** Fixed `min(360px, 100vw - 32px)` vs match input bar width.

---

## 12. Implementation todos (ordered)

- [ ] **t1** — Add `refreshAllToolListUis()`; switch `setToolPermission` / `setToolsEnabled` / `refreshServerToolDisabledState` to refresh all lists (fixes pre-existing drawer ↔ settings desync).
- [ ] **t2** — Extract `src/ui/tools-list.ts` from `settings.ts` with `variant: 'composer'` (hide descriptions).
- [ ] **t3** — Add `composer-tools-popover.css` + button/popover markup (HTML or TS).
- [ ] **t4** — Implement `src/ui/composer-tools-popover.ts` (toggle, outside click, Escape, settings link, server banner id).
- [ ] **t5** — Wire `main.ts`: import CSS, `fillToolsSection('composerToolsList')`, `initComposerToolsPopover()`, extend `registerToolHandlers` for composer list.
- [ ] **t6** — Update `refreshServerToolDisabledState` for `#composerToolsServerBanner`.
- [ ] **t7** — Manual QA checklist (§9.2); fix mobile overflow if needed.
- [ ] **t8** — Optional unit test for multi-list sync.
- [ ] **t9** — Update `documentation/context.md` Tools UI bullet after merge.
- [ ] **t10** — Complete [`documentation/plans/verification/feature-28.md`](../verification/feature-28.md) implementation sign-off (manual §9.2 + acceptance §8).

---

## 13. Mock (ASCII)

```
┌─ composer ─────────────────────────────────────────────┐
│ [Build][Plan]…  [Expert ▼]                             │
│ ┌──────────────────────────────────────────────────┐  │
│ │ 📎  🔧  │  Type a message…                      │  │  ← NEW 🔧
│ └──────────────────────────────────────────────────┘  │
│                    ┌─ Tool permissions ─────────┐   │
│                    │ ⚠ npm start for file tools  │   │
│                    │ ☑ Enable all tools          │   │
│                    │ WEB              [All ☑]    │   │
│                    │  web_search    [Ask ▼]      │   │
│                    │ FILES            [All ☐]    │   │
│                    │  read_file     [Off ▼]      │   │
│                    │ … (scroll)                  │   │
│                    │ [Settings → Tools]          │   │
│                    └─────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## 14. References

- Product backlog: [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § F5
- Context: [`documentation/context.md`](../../context.md) — Tools config, approval gate, UI surfaces
- Tool catalog: [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) — `BUILT_IN_TOOLS`
- Permission types: [`src/tools/tool-settings-types.ts`](../../../src/tools/tool-settings-types.ts)
