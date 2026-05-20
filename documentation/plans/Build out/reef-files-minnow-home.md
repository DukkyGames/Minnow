# Reef user modules in `~/.minnow/reef/modules`

**Summary:** Persist user-created Reef widget modules under the Minnow home directory, not the workspace, with the same path-resolution guarantees as built-in templates.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 2

---

## Problem statement

Reef **templates** already resolve to `@minnow/reef/widgets/` and sync to `~/.minnow/reef/widgets/` (read-only catalog). When the model or user saves a **custom** Reef module (HTML/markdown artifact), tools may still target the **workspace** via `write_file` / `create_file`, polluting the project and breaking the product rule that Reef assets live outside `{{cwd}}`.

---

## Current behavior

| Concern | Today | Key paths |
|---------|-------|-----------|
| Built-in templates | `src/chat/reef/widgets/*.md` | Shipped in repo |
| Home sync (read) | `~/.minnow/reef/widgets/` copied on `npm start` | `server/reef/sync-widgets.js`, `server/config/home.js` (`reef/widgets` scaffold) |
| Tool read resolution | `@minnow/reef/widgets/<name>.md`, `reef/widgets/…` under home | `server/reef/widget-paths.js` (`tryResolveReefWidgetReadPath`, `isAllowedReefWidgetReadPath`) |
| Mode prompt | Explicit: do **not** search workspace for templates | `src/chat/prompts/modes/reef.full.md` |
| User modules dir | **Not implemented** — no `reef/modules` in home layout or path guards | — |
| Write tools | Workspace-scoped unless server adds exceptions | `server/tools/` path policy, `src/tools/workspace-path-guard.ts` |

Reef widgets in chat are **inline fences** mounted as iframes (`src/chat/reef/widget-iframe.ts`); persistence of “modules” as files is a separate concern from live fences.

---

## Proposed solution

### 1. Directory layout

```text
~/.minnow/
  reef/
    widgets/     # existing — synced built-ins (read templates)
    modules/     # NEW — user-authored .md modules (read/write)
```

- Module file convention: `~/.minnow/reef/modules/<slug>.md` containing front matter + `reef-widget` fence (mirror widget template shape).
- Optional subdirs later; v1 flat namespace is enough.

### 2. Server path resolution (mirror widgets)

Extend `server/reef/widget-paths.js` (or split `module-paths.js`):

| Alias | Maps to |
|-------|---------|
| `@minnow/reef/modules/<file>` | `path.join(getMinnowHome(), 'reef/modules', file)` |
| `reef/modules/<file>` | Same (home-relative) |

- `isAllowedReefModuleReadPath` / `isAllowedReefModuleWritePath` — only under home `reef/modules`.
- `write_file` / `create_file` / `read_file` / `find_files` redirect when path matches alias (same pattern as widget reads).
- Deny writes to `reef/widgets/` except sync script (built-ins).

### 3. Home bootstrap

- Add `reef/modules` to `server/config/home.js` scaffold list (like `reef/widgets`).
- `npm start`: create empty `modules/` with `.gitkeep` or README stub.

### 4. Client prompts & tools

- Update `src/chat/prompts/modes/reef.full.md` and `reef.lite.md`:
  - Save custom modules to `@minnow/reef/modules/<slug>.md`, never `{{cwd}}`.
  - `find_files` with `path: "@minnow/reef/modules"`.
- Tool usage doc (`src/chat/prompts/tool-usage/default.full.md`): one paragraph on Reef module paths.

### 5. Optional UI (later slice)

- Settings → Reef → “My modules” list (read home dir via new `GET /api/reef/modules`).

---

## Implementation todos

- [ ] Scaffold `~/.minnow/reef/modules` in `server/config/home.js`
- [ ] Implement `getHomeReefModulesDir()`, resolvers, allowlists in `server/reef/widget-paths.js` (or new module)
- [ ] Wire `resolveSafePath` / tool handlers to accept `@minnow/reef/modules/…` writes
- [ ] Block workspace paths that look like reef modules (`documentation/reef/…`) unless user explicitly wants workspace copy (document as anti-pattern)
- [ ] Update `reef.full.md` / `reef.lite.md` paths table
- [ ] Extend `test/server/reef-widget-paths.test.mjs` → modules resolution tests
- [ ] Document in `documentation/context.md` Reef section
- [ ] Run `npm test` server + reef convention tests

---

## Files to change

| File | Change |
|------|--------|
| `server/config/home.js` | Scaffold `reef/modules` |
| `server/reef/widget-paths.js` | Module path resolve + allowlist |
| `server/tools/*` (path resolution entry) | Write/read redirect |
| `src/chat/prompts/modes/reef.full.md` | Save/load instructions |
| `src/chat/prompts/modes/reef.lite.md` | Lite paths |
| `test/server/reef-widget-paths.test.mjs` | Module path cases |
| `documentation/context.md` | Persistence layout |

---

## Testing plan

1. `npm start` — verify `~/.minnow/reef/modules` exists.
2. Agent `write_file` to `@minnow/reef/modules/test-widget.md` — file appears under home, not workspace.
3. `read_file` same path — content returned.
4. `write_file` to `src/chat/reef/widgets/foo.md` in workspace — denied or redirected per policy.
5. `find_files` `@minnow/reef/modules` lists user modules.
6. Regression: existing `@minnow/reef/widgets` reads still work.

---

## Risks / open questions

- **Naming:** `modules` vs `widgets/user` — align with user-facing “module” language in to-fix.
- **Sync:** Should modules ever sync across machines (dotfiles backup only)?
- **Size limits:** Cap file size / count under home?
- **Relation to optional-save prompt:** Saving to modules may be gated by [`reef-optional-save-prompt.md`](reef-optional-save-prompt.md).
