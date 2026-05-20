---
name: Feature 23 — Manual memory add
overview: Settings → Memory add form (title, body, optional tags) wired to existing createMemoryEntry / POST /api/memory/entries; no server changes for v1.
todos:
  - id: markup-styles
    content: index.html add-memory form + settings-page.css (mirror MCP add panel)
    status: pending
  - id: wire-submit
    content: settings-sections.ts bindMemoryAddForm, parseMemoryTagsInput, panel visibility
    status: pending
  - id: html-tests
    content: Extend test/ui/settings-page-html.test.mjs with add-form id assertions
    status: pending
  - id: manual-verify
    content: Run manual QA + step16-memory-smoke; write verification/feature-23.md sign-off
    status: pending
  - id: context-doc
    content: Update documentation/context.md Memory settings bullet on ship
    status: pending
isProject: false
---

# Feature 23 — Manually add memories in settings

| Field | Value |
|-------|-------|
| **Feature ID** | `feature-23-manual-memory-add` |
| **Backlog** | Epic F — **F2** ([`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § F2) |
| **Wave** | 4 (Settings completeness — with F1–F6) |
| **Size** | S |
| **Status** | Build plan (not implemented) |
| **Depends on** | Step 16 memory (`~/.minnow/memory/`, `POST /api/memory/entries`); Step 20 settings (`#/settings/memory`) |
| **Blocks** | None |
| **Parallel-safe** | **F6** (`feature-29-all-full-permissions`) — different settings sections/files |

---

## Goal

Let users **create memory entries by hand** in **Settings → Memory**: title, body, and optional tags, persisted via existing `POST /api/memory/entries` and shown immediately in the entry list with `source: user`.

---

## Current behavior (research)

### Settings UI — list and delete only

[`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts):

| Piece | Behavior |
|-------|----------|
| `renderMemorySection()` | Loads `fetchMemoryStatus()` / `fetchMemoryEntries(true)`; renders rows via `renderMemoryEntryRow()` |
| `bindMemoryListActions()` | Delegated click on `[data-memory-remove]` → `deleteMemoryEntry(id)` → re-render |
| Offline | Stats show `—`; list shows “Start npm start to view and manage stored memories.” |
| Empty store | “No memory entries yet.” (no create affordance) |

Static shell in [`index.html`](../../../index.html) (`#settingsSection-memory`): enable toggle, stats, `#settingsMemoryList`, backup/clear buttons. **No add form.**

[`src/ui/settings-page.ts`](../../../src/ui/settings-page.ts) wires `settingsMemoryEnabled`, backup, and clear; does not touch create.

### Client API — `createMemoryEntry` exists, unused

[`src/memory/client.ts`](../../../src/memory/client.ts) (lines 112–124):

```ts
export async function createMemoryEntry(input: {
  title: string;
  body: string;
  tags?: string[];
  source?: 'user' | 'agent' | 'self-heal';
}): Promise<MemoryEntryMeta | null>
```

- Uses `memoryFetch` → `POST /api/memory/entries` with JSON body.
- Returns `null` when server offline or non-OK response (no error detail surfaced today).

### Server — POST already implemented

[`server/memory/routes.js`](../../../server/memory/routes.js): `POST /api/memory/entries` → `createEntry(body)` → `201 { entry }`.

[`server/memory/store.js`](../../../server/memory/store.js) `createEntry(input)`:

| Rule | Detail |
|------|--------|
| `title` | String, max 200 chars; default `"Untitled"` |
| `body` | Max **32 KiB** UTF-8 → **413** |
| `tags` | Array of strings, each max 64 chars |
| `source` | `'agent'` \| `'self-heal'` \| else **`'user'`** |
| `id` | Optional valid UUID; settings should **not** send id (server assigns) |
| Capacity | Max **500** entries → **507** |

Agent path [`server/tools/memory-tools.js`](../../../server/tools/memory-tools.js) requires non-empty title and body; manual UI should match that UX expectation.

### Styling

Existing list styles in [`src/styles/settings-page.css`](../../../src/styles/settings-page.css) (`.settings-memory-*`). MCP add form uses `.settings-mcp-form`, `.settings-mcp-add-panel` — reuse or mirror with `.settings-memory-add-*` for consistency.

### Tests today

| Test | Coverage |
|------|----------|
| `test/memory/memory-api.test.mjs` | POST lifecycle, 413 oversize, retrieve |
| `test/ui/settings-page-html.test.mjs` | `#settingsMemoryList` exists; MCP form ids |
| `test/ui/settings-sections.test.mjs` | Export `refreshSettingsSection` only |

**Gap:** No HTML assertion for add form; no UI test for submit wiring.

---

## Decision summary

| Topic | Choice |
|-------|--------|
| Server changes | **None** for v1 — wire UI to existing API |
| Form placement | Collapsible **`<details>`** “Add memory” between stats and list (mirror MCP add panel) |
| Visibility when offline | Panel **hidden** when `fetchMemoryStatus()` is null (same UX as MCP add panel; MCP uses `isLocalServerAvailable()`, memory already uses status API) |
| `source` | Always pass `source: 'user'` on submit |
| Tags input | Single text field: **comma-separated**, trim, drop empties (no `#` required) |
| Required fields | **Title** and **body** required in UI before submit (align with `save_memory` agent tool) |
| Post-submit | Clear form, `setStatus('ok', …)`, `await renderMemorySection()` |
| Error UX | Generic `setStatus('err', …)` on `null` return; optional v1.1: parse JSON `error` from failed POST |

---

## Form UI spec

### Markup (`index.html` — inside `#settingsSection-memory`)

Insert after `#settingsMemoryStats`, before `#settingsMemoryList`:

```html
<p id="settingsMemoryOffline" class="field-hint settings-memory-offline hidden">
  Start with <code>npm start</code> to add and manage memories.
</p>
<details id="settingsMemoryAddPanel" class="settings-memory-add-panel hidden">
  <summary class="settings-memory-add-summary">Add memory</summary>
  <form id="settingsMemoryAddForm" class="settings-memory-form" novalidate>
    <div class="field">
      <label for="settingsMemoryAddTitle">Title</label>
      <input type="text" id="settingsMemoryAddTitle" name="title" required maxlength="200"
        autocomplete="off" placeholder="e.g. Preferred test command">
    </div>
    <div class="field">
      <label for="settingsMemoryAddBody">Body</label>
      <textarea id="settingsMemoryAddBody" name="body" required rows="6"
        placeholder="What should be remembered across chats?"></textarea>
      <p class="field-hint">Max 32 KB. Used for retrieval on send when memory injection is enabled.</p>
    </div>
    <div class="field">
      <label for="settingsMemoryAddTags">Tags (optional)</label>
      <input type="text" id="settingsMemoryAddTags" name="tags" autocomplete="off"
        placeholder="testing, npm">
      <p class="field-hint">Comma-separated. Max 64 characters per tag.</p>
    </div>
    <p id="settingsMemoryAddError" class="settings-memory-form-error hidden" role="alert"></p>
    <div class="settings-memory-form-actions">
      <button type="submit" class="settings-action-btn">Save memory</button>
      <button type="button" id="settingsMemoryAddReset" class="settings-inline-btn">Clear form</button>
    </div>
  </form>
</details>
```

### CSS (`settings-page.css`)

- [ ] `.settings-memory-add-panel`, `.settings-memory-add-summary` — match MCP spacing/typography
- [ ] `.settings-memory-form`, `.settings-memory-form-actions`, `.settings-memory-form-error` — mirror `.settings-mcp-form*`
- [ ] `.settings-memory-offline` — mirror `.settings-mcp-offline`

### Interaction (`settings-sections.ts`)

- [ ] `bindMemoryAddForm()` — once, on `submit` of `#settingsMemoryAddForm` (same pattern as `bindMcpAddForm()`)
- [ ] `clearMemoryAddForm()` — reset fields + hide `#settingsMemoryAddError`
- [ ] `parseMemoryTagsInput(raw: string): string[]` — split on `,`, trim, filter empty, cap count if desired (server accepts any array length; keep reasonable e.g. 20 tags in UI)
- [ ] Submit handler:
  1. `preventDefault`
  2. Validate title/body non-empty (show inline error element)
  3. `const entry = await createMemoryEntry({ title, body, tags, source: 'user' })`
  4. On success: clear form, close optional `details.open = false`, status OK, `renderMemorySection()`
  5. On failure: status err (“Save failed — use npm start” or “Body too large” if enhanced)
- [ ] `renderMemorySection()` toggles:
  - `#settingsMemoryOffline` / `#settingsMemoryAddPanel` `.hidden` from `!!status` (online)
  - When offline, skip list fetch (unchanged)

Import `createMemoryEntry` from `../memory/client` alongside existing memory imports.

**No changes** to `settings-page.ts` unless enable toggle should disable the add form when memory store disabled — **recommend:** still allow manual adds when store disabled (entries persist; injection skipped). Copy in hint already explains injection needs enabled store + `npm start`.

---

## Build plan

### Phase 1 — Markup and styles

- [ ] Add form HTML to `index.html` (ids above)
- [ ] Add CSS classes in `settings-page.css`

### Phase 2 — Wire submit and refresh

- [ ] Import and use `createMemoryEntry` in `settings-sections.ts`
- [ ] Implement `bindMemoryAddForm`, `clearMemoryAddForm`, `parseMemoryTagsInput`
- [ ] Extend `renderMemorySection()` for offline/add-panel visibility
- [ ] Call `bindMemoryAddForm()` from `renderMemorySection()` (guard with `memoryAddBindingsDone` flag like MCP)

### Phase 3 — Polish

- [ ] After save, scroll new entry into view optional (nice-to-have; skip if S scope tight)
- [ ] `settingsMemoryAddReset` click → `clearMemoryAddForm()`

### Out of scope (v1)

- Edit existing entries in UI (PUT exists; separate feature)
- Pin toggle in UI
- Client `createMemoryEntry` returning structured errors (413/507 messages)
- Playwright / browser E2E
- Changes to `save_memory` tool or composer memory part

---

## Tests

| Area | File | Cases |
|------|------|--------|
| HTML contract | `test/ui/settings-page-html.test.mjs` | Assert `settingsMemoryAddForm`, `settingsMemoryAddTitle`, `settingsMemoryAddBody`, `settingsMemoryAddTags`, `settingsMemoryAddPanel` |
| Tag parsing (optional) | `test/ui/memory-tags-parse.test.mjs` or inline in settings test | `"a, b ,,c"` → `['a','b','c']`; empty → `[]` — only if `parseMemoryTagsInput` is exported |
| API (unchanged) | `test/memory/memory-api.test.mjs` | Already covers POST; no change required unless asserting `source: user` default |

Run: `npm test` and `npm run build`.

**Note:** Full submit flow needs `npm start` + browser; keep automated coverage at HTML + pure helpers; manual checklist below.

---

## Verification (manual)

1. `npm start`, open `#/settings/memory`.
2. Confirm **Add memory** panel visible; offline banner hidden.
3. Submit empty form → inline validation, no API call.
4. Add entry: title `Manual note`, body `Created from settings`, tags `manual, test` → success toast, form cleared, list shows new row with badge **user**, body text, tags.
5. Stop server → panel hidden / offline copy; list shows npm start message.
6. Optional: add body &gt; 32 KB → error (generic or 413 message).
7. `npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173` still passes.

---

## Documentation follow-up

- [ ] Update [`documentation/context.md`](../../context.md) Memory settings bullet: manual add form via `createMemoryEntry` / `POST /api/memory/entries`.

---

## Implementation todos

- [ ] **M1** — `index.html` add-memory form + offline hint
- [ ] **M2** — `settings-page.css` form styles (mirror MCP)
- [ ] **M3** — `settings-sections.ts`: bind form, parse tags, `createMemoryEntry`, panel visibility in `renderMemorySection`
- [ ] **M4** — `test/ui/settings-page-html.test.mjs` form id assertions
- [ ] **M5** — Manual verification checklist
- [ ] **M6** — `context.md` memory settings line

---

## Files touched (expected)

| Path | Change |
|------|--------|
| [`index.html`](../../../index.html) | Add `#settingsMemoryOffline`, `#settingsMemoryAddPanel`, form fields (after stats, before list) |
| [`src/styles/settings-page.css`](../../../src/styles/settings-page.css) | `.settings-memory-add-*`, `.settings-memory-form*` (mirror MCP) |
| [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) | `bindMemoryAddForm`, `clearMemoryAddForm`, `parseMemoryTagsInput`, panel toggles in `renderMemorySection` |
| [`test/ui/settings-page-html.test.mjs`](../../../test/ui/settings-page-html.test.mjs) | Assert add-form element ids |
| [`documentation/context.md`](../../context.md) | Memory settings bullet — manual add on ship |
| [`documentation/plans/verification/feature-23.md`](../verification/feature-23.md) | Sign-off checklist (this feature) |

**No server / schema changes** for v1. Optional later: structured errors in `createMemoryEntry`, tag-parse unit test file.

---

## Acceptance criteria

### From backlog F2

1. **Add memory** form in Settings → Memory: title, body, optional tags → `POST /api/memory/entries`.
2. List/delete behavior unchanged; new rows use existing `renderMemoryEntryRow` badge for `source`.

### Edge cases (plan)

3. Title and body required in UI before submit (align with `save_memory` agent tool).
4. New entry appears in the list without page reload; `source` displays as **user**.
5. Add panel hidden when memory API unavailable; offline copy visible (mirror MCP section).
6. Tags: comma-separated, trim, drop empties; per-tag max 64 chars enforced server-side.
7. Body &gt; 32 KiB → failed save (generic err in v1; 413 optional in v1.1).
8. `npm test` and `npm run build` pass; HTML contract test covers form ids.

### Verifier sign-off

Report **PASS** only when criteria 1–8 hold and manual **U1–U7** in [`documentation/plans/verification/feature-23.md`](../verification/feature-23.md) are checked after implementation.

---

## Verifier handoff

Create / update [`documentation/plans/verification/feature-23.md`](../verification/feature-23.md):

- **Automated:** `npm run build`, `npm test` (including `test/ui/settings-page-html.test.mjs` add-form ids; `test/memory/memory-api.test.mjs` regression)
- **Manual:** U1–U7 from § Verification (manual) below
- **Smoke:** `npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173`
