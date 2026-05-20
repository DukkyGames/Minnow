# Feature 29 — All full permissions (Settings → Tools)

**Backlog ID:** F6 · `feature-29-all-full-permissions`  
**Wave:** 4 (Settings completeness)  
**Size:** S  
**Status:** Implemented  
**Parallel-safe with:** F2 (manual memory add) — different sections/files  

---

## Problem

Power users who trust their model and workspace want to stop clicking **Requires permission** on every file, git, and shell tool. Today they must change **every built-in catalog tool** (46 ids in [`BUILT_IN_TOOLS`](../../../src/tools/definitions.ts)) one at a time via the permission `<select>`, or use **Enable all tools** checkboxes—which only toggle **`ask`** / **`off`**, never **`full`**.

The settings page already documents three modes in intro copy (`settings-sections.ts` ~781–786) and mirrors the drawer list via `fillToolsSection('settingsToolsList')`, but there is no one-shot **trust all tools** or **restore factory permissions** control.

### Current behavior (researched)

| Area | Behavior |
|------|----------|
| **Settings → Tools** | `renderToolsSection()` in [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) mounts intro, **Filesystem access** radios (separate `toolSecurity.filesystemAccess` via `saveToolSecurityMeta`), then `fillToolsSection('settingsToolsList')`. |
| **Tool list UI** | [`fillToolsSection()`](../../../src/ui/settings.ts) builds `.tool-list-toolbar` with global **Enable all tools** checkbox → `setToolsEnabled(ids, checked)` sets **`ask`** when enabling, **`off`** when disabling ([`src/tools/config.ts`](../../../src/tools/config.ts) ~354–360). |
| **Per-tool select** | `setToolPermission(id, mode)` persists `permissions[id]` and calls `syncEnabledFromPermissions` + `loadToolConfigIntoDrawer` (does not call `syncToolSelectAllControls` — bulk helpers should). |
| **Defaults** | [`defaultToolConfig()`](../../../src/config/defaults.ts): `get_datetime`, `calculate`, `web_search`, `wikipedia_search`, `save_memory` → **`ask`**; all other built-ins → **`off`**. |
| **Execution** | [`maybeBlockToolForUserApproval`](../../../src/tools/permission-gate.ts) / `toolInvocationWouldPrompt`: **`full`** skips permission modal; paths outside workspace still prompt when `toolSecurity.filesystemAccess === 'workspace'` ([`src/config/tool-security-meta.ts`](../../../src/config/tool-security-meta.ts), server read via [`server/config/tool-security.js`](../../../server/config/tool-security.js)). |
| **Persistence split** | Per-tool modes → `tools.json` (`permissions` + mirrored `enabled`). Filesystem policy → `config.json` `toolSecurity.filesystemAccess` — **not** changed by this feature. |
| **Out of scope for this feature** | Filesystem **full disk** radio (confirm at `settings-sections.ts` ~839–846). MCP `mcp__*` permission keys in `tools.json` (not in `BUILT_IN_TOOLS`). Settings drawer toolbar (v1: **settings page only**; F28 composer popover may reuse helpers — see [`feature-28-composer-tools-button.md`](feature-28-composer-tools-button.md)). |

### Goal

On **Settings → Tools**, add:

1. **All full permissions** — after confirm, set every **built-in** catalog tool to **`full`**, persist, refresh list + bulk checkboxes.
2. **Reset to defaults** (recommended) — after confirm, restore built-in permissions/enabled flags to `defaultToolConfig()` while **preserving** `keys.braveApiKey` and any extra `permissions` entries (e.g. `mcp__*`).

---

## UX specification

### Placement

Insert a **bulk actions** row inside `renderToolsSection()`, **after** the intro paragraph and **before** the Filesystem access block (so filesystem policy stays visually separate from per-tool permissions).

```text
[Intro note]
[All full permissions] [Reset to defaults]     ← new
[Filesystem access for AI tools]
[Tool list + Brave key panel]
```

Use existing settings patterns: `settings-inline-btn` or a small `settings-tools-bulk-actions` flex row; optional `settings-tools-bulk-actions--danger` for the primary destructive-trust action (match `.settings-radio-option` / panel tone in [`settings-page.css`](../../../src/styles/settings-page.css)).

### Copy

**All full permissions** — `window.confirm` (same pattern as full filesystem radio ~839–846 in `settings-sections.ts`):

```text
Grant full permission to all tools?

Every built-in tool will run without the approval prompt. File, git, shell, and browser tools can change your project or machine depending on the model’s requests.

This does not change “Filesystem access” below (workspace vs full disk). Only use this if you accept that risk.

[Cancel] [OK]
```

On cancel: no persistence, no status toast.

On OK: `setStatus('ok', 'All tools set to full permission')` (or similar).

**Reset to defaults** — confirm:

```text
Reset all tool permissions to defaults?

Built-in tools will return to factory on/off and ask settings. Your Brave API key will be kept.

[Cancel] [OK]
```

On OK: `setStatus('ok', 'Tool permissions reset to defaults')`.

### Server-offline behavior

- **All full:** Still write **`full`** for **all** `BUILT_IN_TOOLS` ids in config (user intent survives `npm start`). Server-required rows may stay **disabled** in the UI until ping succeeds (`refreshServerToolDisabledState`); selects should show **`full`** once enabled.
- **Reset:** Same as today—no server required for browser-only defaults; server tools remain **`off`** in defaults until user enables them.
- If `GET /api/config/tools` failed at boot (`serverToolsFetchFailed`): bulk actions still update in-memory cache; `saveToolConfigAsync` may error—surface existing `setStatus('err', 'Could not save — use npm start')` pattern.

---

## Implementation design

### New API in `src/tools/config.ts`

Add focused helpers (keep bulk checkbox logic unchanged). For **unit tests**, also export pure mutators that take `ToolConfig` and return the updated object (no `document`), e.g. `applyAllBuiltInToolPermissions(config, mode)` and `applyDefaultBuiltInPermissions(config)`; UI wrappers call those then `saveToolConfigAsync` + refresh.

```ts
/** Pure: set every BUILT_IN_TOOLS id to mode; sync enabled mirror. */
export function applyAllBuiltInToolPermissions(
  config: ToolConfig,
  mode: ToolPermissionMode,
): ToolConfig

/** Pure: copy built-in permissions/enabled from defaultToolConfig(); preserve keys + non-catalog permission ids. */
export function applyDefaultBuiltInPermissions(config: ToolConfig): ToolConfig

/** Set every built-in catalog tool to the same permission mode; persist + refresh UI under root. */
export function setAllBuiltInToolPermissions(
  mode: ToolPermissionMode,
  root: ParentNode = document,
): { updated: number }

/** Restore built-in permissions/enabled from defaults; persist + refresh UI. */
export function resetBuiltInToolPermissionsToDefaults(
  root: ParentNode = document,
): void
```

**`setAllBuiltInToolPermissions('full')` algorithm:**

1. `const config = loadToolConfig()`.
2. For each `tool` in `BUILT_IN_TOOLS`: `config.permissions[tool.id] = mode` (do not special-case `web_search_ddg`—not in catalog; permission flows through `web_search`).
3. `syncEnabledFromPermissions(config)`.
4. `await saveToolConfigAsync(config)` from settings UI click handler (avoid reload race; drawer can keep sync `saveToolConfig` if added later).
5. `loadToolConfigIntoDrawer(root)` + `syncToolSelectAllControls(root)`.
6. If [`refreshAllToolListUis`](../../../src/tools/config.ts) exists (shipped with F28), call it instead of only `root` so drawer `#toolsList` stays in sync.

**`resetBuiltInToolPermissionsToDefaults` algorithm:**

1. `const config = loadToolConfig()`.
2. `const defaults = defaultToolConfig()`.
3. For each built-in id: copy `defaults.permissions[id]` and `defaults.enabled[id]`.
4. Leave `config.keys` unchanged; leave `permissions` entries whose id is **not** in `BUILT_IN_TOOLS` (e.g. `mcp__foo`) untouched.
5. `syncEnabledFromPermissions` → save → refresh UI (same as above).

**Do not** auto-set `toolSecurity.filesystemAccess` to `full` when user clicks **All full permissions**—that is a stronger, disk-wide policy with its own confirm.

### UI in `src/ui/settings-sections.ts`

Inside `renderToolsSection()` after intro `mount.appendChild(...)`:

1. Create `div.settings-tools-bulk-actions` with two `button type="button"` elements:
   - `id="settingsToolsAllFull"` — label **All full permissions**
   - `id="settingsToolsResetDefaults"` — label **Reset to defaults**
2. Bind click handlers once per mount **or** re-bind each render (same rationale as Brave key re-bind ~901–908): `clearMount` destroys nodes, so attach listeners on the new buttons every `renderToolsSection` call.
3. Handlers call confirm → config helpers → `loadToolConfigIntoDrawer` on `#settingsToolsList` (list may not exist until after `fillToolsSection`; order: create buttons → `fillToolsSection` → bind buttons, or bind after `fillToolsSection` completes).

### Optional small extension in `src/ui/settings.ts`

Not required for acceptance. If product later wants the same buttons in the quick drawer, export a `createToolsBulkActionsBar(): HTMLElement` from `settings.ts` and call it from both `fillToolsSection` (guard with `containerId === 'settingsToolsList'`) and `renderToolsSection`. **V1: settings page only.**

### CSS

[`src/styles/settings-page.css`](../../../src/styles/settings-page.css):

- `.settings-tools-bulk-actions` — flex gap, padding below intro / above filesystem section.
- `.settings-tools-bulk-actions .settings-inline-btn` or dedicated class for visual hierarchy (reset = neutral, all-full = caution).

No `index.html` changes (dynamic section body `#settingsToolsBody` already exists).

---

## File change list

| File | Change |
|------|--------|
| [`src/tools/config.ts`](../../../src/tools/config.ts) | Add pure `applyAllBuiltInToolPermissions` / `applyDefaultBuiltInPermissions` plus UI wrappers `setAllBuiltInToolPermissions`, `resetBuiltInToolPermissionsToDefaults`; export for tests. |
| [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) | Bulk actions row + confirm + async save in `renderToolsSection()`. |
| [`src/styles/settings-page.css`](../../../src/styles/settings-page.css) | Layout/styles for bulk actions row. |
| [`test/tools/config-bulk-permissions.test.mts`](../../../test/tools/config-bulk-permissions.test.mts) | **New** — unit tests without DOM. |
| [`documentation/context.md`](../../../documentation/context.md) | One bullet under **minnow.tools** / Settings → Tools (on ship, not in this doc-only task). |

**No** server, schema, or `tools.json` shape changes.

---

## Schema / API / migration

| Topic | Decision |
|-------|----------|
| **`tools.json` shape** | Unchanged. Bulk write only `permissions` + mirrored `enabled`. |
| **`config.json` / toolSecurity** | Unchanged by this feature. |
| **Migration** | None. Existing users keep FS mode; bulk full only updates tool rows. |
| **MCP tools** | v1: only `BUILT_IN_TOOLS` ids. Document follow-up: “Also set all `mcp__*` keys to full?” if MCP permissions UI expands. |

---

## Acceptance criteria

### Must have

- [ ] **Settings → Tools** shows **All full permissions** and **Reset to defaults** above the filesystem block.
- [ ] **All full permissions** shows confirm dialog; cancel leaves config unchanged.
- [ ] Confirm sets **every** built-in tool in [`BUILT_IN_TOOLS`](../../../src/tools/definitions.ts) to **`full`** in `permissions` and persists to `~/.minnow/tools.json` when `npm start` (or `localStorage` in dev-only mode).
- [ ] After apply, each permission `<select>` shows **Full permission**; global/category **Enable all** checkboxes reflect all-on (`getToolBulkCheckboxState`).
- [ ] Running a previously **`ask`** tool (e.g. `read_file` with server up) does **not** show the approval modal when paths stay in workspace.
- [ ] **Reset to defaults** shows confirm; cancel leaves config unchanged.
- [ ] Reset restores the same built-in permission map as a fresh install (`defaultToolConfig()`), preserves **Brave API key**, does not remove `mcp__*` permission entries if present.
- [ ] Intro copy still accurate; filesystem radios independent (reset does not flip FS to full; all-full does not flip FS to full).

### Edge cases

- [ ] User on **`npm run dev`** without server: bulk full updates UI/cache; save to localStorage when not in server storage mode; err toast if server mode but PUT fails.
- [ ] Server tools while offline: permissions saved as **`full`**; rows disabled until ping; no crash.
- [ ] Re-enter **Settings → Tools**: buttons work after `clearMount` (listeners on new nodes).
- [ ] Settings drawer (`#toolsList`) unchanged unless explicitly extended—no regression to drawer bulk **ask**/**off** checkboxes.

### Nice to have (defer if timeboxed)

- [ ] `aria-describedby` on bulk buttons pointing to intro security note.
- [ ] Disable **All full** when `serverToolsFetchFailed` and show hint (optional; in-memory apply may still be useful).

---

## Test plan

### Automated (`npm test`)

Add [`test/tools/config-bulk-permissions.test.mts`](../../../test/tools/config-bulk-permissions.test.mts):

| Case | Assert |
|------|--------|
| `setAllBuiltInToolPermissions('full')` on normalized config | Every `BUILT_IN_TOOLS` id has `permissions[id] === 'full'` and `enabled[id] === true`. |
| `resetBuiltInToolPermissionsToDefaults` | Built-in ids match `defaultToolConfig()`; `keys.braveApiKey` unchanged when preset to `"test-key"`. |
| Unknown `permissions['mcp__test']` | Preserved after reset. |
| `getToolPermissionForId` after bulk full | `web_search` is `full` (alias behavior for execution unchanged). |

Test `applyAllBuiltInToolPermissions` / `applyDefaultBuiltInPermissions` on plain `ToolConfig` objects (no `document`, no `loadToolConfig` cache).

### Manual QA

1. `npm start` → Settings → Tools → **All full permissions** → confirm → spot-check `read_file`, `run_terminal_cmd`, `web_search` selects → **Full permission**.
2. Send chat message that triggers `read_file` inside workspace → no approval strip.
3. **Reset to defaults** → only default-on tools show **Requires permission**; file tools **Disabled**.
4. Set Brave key → reset → key still present.
5. Toggle filesystem to **Restrict to workspace** → all-full → run tool with path outside workspace → approval still appears (`permission-gate` path rule).
6. Stop server → all-full → restart server → permissions still **full** in UI.
7. Reload page → permissions persisted.

---

## Implementation todos

Ordered checklist for the implementing agent:

- [ ] **1. Config helpers** — Implement pure `apply*` functions + UI wrappers `setAllBuiltInToolPermissions` / `resetBuiltInToolPermissionsToDefaults` in `src/tools/config.ts` with `syncEnabledFromPermissions`, `saveToolConfigAsync`, `loadToolConfigIntoDrawer`, and `syncToolSelectAllControls`.
- [ ] **2. Unit tests** — Add `test/tools/config-bulk-permissions.test.mts`; run `npm test`.
- [ ] **3. Settings UI** — Bulk actions row in `renderToolsSection()` with confirm dialogs and status toasts; bind after list mount.
- [ ] **4. Styles** — `.settings-tools-bulk-actions` in `settings-page.css`.
- [ ] **5. Manual QA** — Execute manual test plan above.
- [ ] **6. Docs** — Update `documentation/context.md` Tools section with bulk actions sentence.
- [ ] **7. Verification** — Complete [`documentation/plans/verification/feature-29.md`](../verification/feature-29.md) manual + automated sign-off.

---

## Dependencies and follow-ups

| Item | Relation |
|------|----------|
| **F5 `feature-28-composer-tools-button`** | May import same config helpers for a composer popover; not a blocker. |
| **Tool approval / permission-gate** | No code change expected; behavior validated by QA. |
| **Filesystem full access** | Stays separate; cross-mentioned in confirm copy only. |

---

## Open questions (resolve during implementation)

1. **Reset confirm:** Required for v1 (recommended yes—destructive to user’s custom per-tool mix).
2. **Drawer parity:** Ship settings-only unless product asks for drawer buttons in same PR.
3. **MCP `mcp__*` bulk full:** Defer unless `permissions` already lists MCP ids in typical installs.

---

## Verifier handoff

Create [`documentation/plans/verification/feature-29.md`](../verification/feature-29.md):

- **Plan sign-off:** backlog F6 + deliverable template (this document).
- **Automated (post-implementation):** `npx tsx --test test/tools/config-bulk-permissions.test.mts` (or path wired in `package.json` `npm test`).
- **Manual:** acceptance criteria § Must have + manual QA steps 1–7 in Test plan.
- **Sign-off:** PASS only when UI buttons, confirms, persistence, reset preservation, and filesystem independence all hold; optional F28 `refreshAllToolListUis()` call if that helper shipped.

---

## References

- Backlog: [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — F6
- Architecture: [`documentation/context.md`](../../../documentation/context.md) — `minnow.tools`, tool approval
- Related: [`feature-28-composer-tools-button.md`](feature-28-composer-tools-button.md) (may add `refreshAllToolListUis`; optional shared refresh from bulk helpers)
- Related step context: settings page dynamic sections (`step-20-settings-page` pattern)
