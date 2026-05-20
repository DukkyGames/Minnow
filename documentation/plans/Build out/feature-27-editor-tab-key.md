# Feature 27 — Tab inserts indent in file editor

| Field | Value |
| --- | --- |
| **ID** | `feature-27-editor-tab-key` |
| **Epic** | E — File panel (**E5**) |
| **Backlog** | [`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § E5 |
| **To-fix** | [`to-fix.md`](../to-fix.md) L27 — Tab in file editor triggers browser focus, not indent |
| **Wave** | 1 (parallel-safe with E4, E6, A1, C3 per backlog) |
| **Size** | S |
| **Status** | Build plan (not yet implemented) |
| **Depends on** | Step 11 file viewer (CodeMirror 6 in `file-viewer.ts`) — already shipped |
| **Blocks** | None |
| **Related** | E6 [`feature-26-stats-strip-with-editor.md`](feature-26-stats-strip-with-editor.md) (same editor pane; independent) |
| **Key files** | [`src/ui/file-viewer.ts`](../../../src/ui/file-viewer.ts), [`src/ui/file-editor-extensions.ts`](../../../src/ui/file-editor-extensions.ts), [`package.json`](../../../package.json) |

---

## Summary

Bind **Tab** / **Shift+Tab** to CodeMirror `indentWithTab` in the split file viewer so indentation stays in the editor instead of moving browser focus. Add an explicit **Escape → blur** exit so keyboard users can leave the editor and Tab-navigate the rest of Minnow. Maps backlog goal `indentWithTab: true`, `defaultTabBehavior: 'indent'`, and **Esc still blurs** to CM6 APIs (not literal config keys).

---

## 1. Problem

In the split file viewer, **Tab does not indent** — the key event bubbles to the browser and moves focus to the next focusable control (Save, Close, composer, sidebar). That matches CodeMirror 6’s **default** behavior: Tab is intentionally **not** bound so the editor passes WCAG “no keyboard trap” guidance.

Users expect an IDE-like editor: **Tab** indents (or inserts a soft tab at the cursor), **Shift+Tab** outdents, and they can still **leave** the editor with the keyboard.

**Success (backlog):** Tab indents inside CodeMirror; **Escape** still provides a way to exit editor focus so Tab can navigate the rest of the app.

---

## 2. Current architecture (research)

### 2.1 `src/ui/file-viewer.ts` — editor mount

| Piece | Behavior |
| --- | --- |
| `mountEditor()` | Async: language packs, optional LSP, `EditorState.create` + `new EditorView` on `.file-viewer-editor-mount` |
| Extensions today | `lineNumbers()`, read-only facets for large-file excerpt, `lspEditorExtensions(path)`, dirty `updateListener`, **custom** `keymap.of([{ key: 'Mod-s', run: save }])`, theme, `minnowEditorExtensions()`, lang extensions |
| **Tab** | **No** Tab binding → browser default focus navigation |
| **Escape** | **No** custom binding → CM default keymap (if any) may run `simplifySelection`; focus often **stays** in `.cm-editor` |

```217:225:src/ui/file-viewer.ts
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void saveCurrentFile();
              return true;
            },
          },
        ]),
```

### 2.2 `src/ui/file-editor-extensions.ts` — LSP only

- Exports `lspEditorExtensions(filePath)` → `@codemirror/autocomplete` override calling `POST /api/lsp/completion`.
- **No** keymaps, **no** indent/tab configuration.
- Correct home for **shared** editor extensions (keymap + indent facets) alongside LSP.

### 2.3 `src/ui/codemirror-theme.ts`

- Syntax highlighting only (`syntaxHighlighting(minnowHighlightStyle)`).
- Unrelated to Tab.

### 2.4 Markup / focus context (`index.html`)

```538:548:index.html
  <section class="file-viewer-pane hidden" id="fileViewerPane" aria-label="File viewer">
    <header class="file-viewer-header">
      ...
    <div class="file-viewer-body" id="fileViewerHost"></div>
```

Focusables near the editor: **Save**, **Close**, file tree rows, chat composer (`#msgInput`), top bar. Tab from an unfocused-trapped editor currently lands on those controls instead of indenting.

### 2.5 Dependencies (`package.json`)

| Package | Present | Notes |
| --- | --- | --- |
| `@codemirror/view` | Yes | `keymap`, `EditorView` |
| `@codemirror/state` | Yes | `EditorState` |
| `@codemirror/language` | Yes | `indentUnit`, language-aware indent |
| `@codemirror/commands` | **No** | Required for `indentWithTab` ([CM Tab example](https://codemirror.net/examples/tab/)) |

`npm ls @codemirror/commands` → empty. **Add** `@codemirror/commands` as a direct dependency (version aligned with other `@codemirror/*` ^6.x).

### 2.6 Backlog wording vs CodeMirror API

| Backlog phrase | CodeMirror 6 equivalent |
| --- | --- |
| `indentWithTab: true` | `import { indentWithTab } from '@codemirror/commands'` and `keymap.of([indentWithTab, …])` |
| `defaultTabBehavior: 'indent'` | **Not** a CM6 config key — means Tab runs **`indentMore`** (selection → `indentMore`; empty line → language `indentOnInput` / `indentUnit`), not focus escape |
| Esc still blurs | Preserve **keyboard exit**: CM built-in **Escape then Tab** (tab-focus mode) **plus** explicit **Escape → blur** on the editor root for one-key exit (see §4.2) |

### 2.7 CodeMirror reference behavior

From [Tab handling example](https://codemirror.net/examples/tab/):

- `indentWithTab` = `{ key: 'Tab', run: indentMore, shift: indentLess }`.
- Default: Tab not handled; **Escape then Tab** moves focus out; **Ctrl-m** / **Shift-Alt-m** (macOS) toggles `toggleTabFocusMode`.
- Docs ask apps that bind Tab to document an escape hatch.

### 2.8 Existing tests

- `test/file/file-viewer-save.test.mjs` — pure helpers + `saveCurrentFile` / `bindFileViewerControls`; **no** CodeMirror mount.
- No test today asserts editor keymaps.

### 2.9 Read-only large-file mode

When `readOnlyExcerpt` is true, `EditorState.readOnly.of(true)` is set — `indentMore` should **not** mutate the doc (CM blocks changes). Tab behavior in read-only preview is **out of scope** for acceptance; manual QA only needs editable files.

---

## 3. Goal

| Requirement | Detail |
| --- | --- |
| **Tab indents** | In editable viewer, **Tab** indents line(s) or inserts indent at cursor; does **not** move browser focus |
| **Shift+Tab** | Outdents (`indentLess` via `indentWithTab`) |
| **Escape exit** | **Escape** blurs the CodeMirror editor (or moves focus to a sensible sibling) so a subsequent **Tab** navigates the Minnow UI |
| **Mod-s unchanged** | Save shortcut keeps working |
| **LSP autocomplete** | Tab with completion open should accept completion (CM autocomplete default); verify no regression |
| **Accessibility note** | Document in plan verification: Escape-then-Tab still works; optional mention in UI tooltip on file viewer (defer tooltip unless product asks) |
| **Read-only excerpt** | No change required beyond CM read-only guard |

---

## 4. Design

### 4.1 Recommended approach — `file-editor-extensions.ts` + `@codemirror/commands`

1. **Add dependency:** `@codemirror/commands` (e.g. `^6.8.0`, match sibling CM packages).
2. **New export** (name suggestion): `fileEditorKeymapExtensions(): Extension[]` in `src/ui/file-editor-extensions.ts`:
   - `indentWithTab` from `@codemirror/commands`
   - `indentUnit.of('  ')` from `@codemirror/language` (2 spaces — matches common TS/JS editors; adjust if product prefers 4)
3. **`mountEditor()`** in `file-viewer.ts`:
   - Spread `...fileEditorKeymapExtensions()` **before** or **after** Mod-s keymap (both in `keymap.of([...])` **or** two `keymap.of` extensions — prefer **one** array: `[indentWithTab, { key: 'Mod-s', … }, escapeBlur]`).
   - Apply keymaps for **both** editable and read-only mounts (read-only: indent commands no-op on doc).

**Do not** put Tab logic in `codemirror-theme.ts` (theme only).

### 4.2 Escape → blur (backlog “Esc still blurs”)

Add a high-priority key binding:

```ts
{
  key: 'Escape',
  run: (view) => {
    view.dom.blur();
    return true;
  },
},
```

- Runs **instead of** only `simplifySelection` when we prepend this to a dedicated `keymap.of` with **higher precedence** (place **after** `indentWithTab` in the same `keymap.of` array — CM runs bindings in order; first `return true` wins).
- **Alternative (stricter CM):** rely on built-in Escape-then-Tab only — **rejected** for this feature because backlog explicitly calls out blur/exit behavior and users expect single Esc in small embedded editors.

Optional: after blur, focus `#btnFileViewerSave` or file tree — **defer**; blurring `.cm-editor` is enough for Tab to reach chrome.

### 4.3 Keymap precedence / autocomplete

| Scenario | Expected |
| --- | --- |
| Completion popup active | Tab selects completion (autocomplete extension handles first) |
| No popup | `indentWithTab` → `indentMore` |
| Mod-s | Save (existing) |

If Tab steals completion in QA, add `indentWithTab` **below** `lspEditorExtensions` in the extension array (already the case if LSP is before keymaps) or use autocomplete’s default keymap — verify manually.

### 4.4 `defaultTabBehavior: 'indent'` mapping

Implement **only** via `indentWithTab` (indent/outdent commands). No separate config object unless Settings later exposes “tab size” (out of scope).

### 4.5 Extension order in `mountEditor` (target)

```text
lineNumbers()
readOnlyExts (if excerpt)
lspExts (if enabled)
updateListener
keymap.of([ indentWithTab, Mod-s, Escape-blur ])   ← new/changed
EditorView.theme(...)
indentUnit (if not inside fileEditorKeymapExtensions)
minnowEditorExtensions()
langExts
```

---

## 5. Exact file change list

| File | Change |
| --- | --- |
| `package.json` | Add `@codemirror/commands` dependency |
| `package-lock.json` | Lockfile update (after `npm install`) |
| `src/ui/file-editor-extensions.ts` | Export `fileEditorKeymapExtensions()` (+ optional `indentUnit`); document Tab/Escape behavior in file header |
| `src/ui/file-viewer.ts` | Import and spread keymap extensions in `mountEditor`; merge Mod-s into same keymap or keep two `keymap.of` |
| `documentation/context.md` | After ship: File panel bullet — Tab indents, Esc blurs editor |
| **New** `documentation/plans/verification/feature-27.md` | Manual QA checklist (optional, post-implementation) |

**Out of scope:**

- Composer / settings / drawer Tab traps (`settings.ts` drawer Tab cycle — unrelated)
- Terminal Tab completion (backlog D1 / to-fix L6)
- Tab size user setting in Settings
- `feature-26` stats layout

---

## 6. Schema / API / migration

| Area | Change |
| --- | --- |
| **Persistence** | None |
| **REST** | None |
| **`filePanel` config** | None |

---

## 7. Acceptance criteria

- [ ] Open editable file in viewer, focus editor, press **Tab** → indentation increases (spaces or block indent); focus **stays** in editor.
- [ ] **Shift+Tab** → outdent when applicable.
- [ ] **Tab** does **not** jump to Save / Close / composer while editor is focused.
- [ ] Press **Escape** → editor loses focus (activeElement is not `.cm-content` / `.cm-editor`).
- [ ] After Escape, **Tab** moves focus within the app (e.g. to Save or next control).
- [ ] **Ctrl/Cmd+S** still saves when dirty.
- [ ] With LSP enabled, type to trigger completion → **Tab** accepts suggestion when popup visible; without popup, indents.
- [ ] Read-only large-file excerpt: no erroneous doc mutation (Tab may no-op or not apply — acceptable).
- [ ] `npm run build` passes; `npm test` passes including new keymap test.

---

## 8. Test plan

### 8.1 Automated

| Test | File | Approach |
| --- | --- | --- |
| **Keymap extensions export** | `test/file/file-editor-keymap.test.mjs` (new) | Import `fileEditorKeymapExtensions`, build minimal `EditorState` + `EditorView` in **happy-dom** (same stack as `file-viewer-save.test.mjs`), mount short doc, `view.focus()`, dispatch **Tab** via `view.dispatch` or synthetic keydown — assert doc changed / selection moved OR `indentMore` effect (line starts with spaces). |
| **Escape blur** | Same file | After mount, focus editor, run Escape binding (keydown `Escape` on `view.dom`), assert `document.activeElement !== view.dom` and not contained in `view.dom`. |
| **Regression** | `test/file/file-viewer-save.test.mjs` | Existing tests still pass |

```bash
npm test -- test/file/file-editor-keymap.test.mjs
npm test -- test/file/file-viewer-save.test.mjs
```

**Implementation note:** Export `fileEditorKeymapExtensions` for testability; avoid testing private `mountEditor` internals.

Optional lighter test (if happy-dom key events are flaky): export `FILE_EDITOR_TAB_KEYBINDINGS` constant array and assert it includes `indentWithTab` and Escape handler — prefer **one** integration-style Tab test if feasible.

### 8.2 Manual QA

1. `npm start` — set workspace, open Files, open `src/main.ts` (or any editable source).
2. Click in editor, press Tab mid-line → indent; Shift+Tab → outdent.
3. Multi-line selection → Tab indents all lines.
4. Tab repeatedly → focus never leaves editor until Escape.
5. Escape → Tab → focus moves to viewer chrome or next page control.
6. Mod-s saves; dirty ● clears.
7. Enable LSP, trigger completion on `import` → Tab accepts; clear popup, Tab indents.
8. Open >512 KB file (read-only excerpt) → Tab does not corrupt content.

### 8.3 Build

```bash
npm install
npm run build
npm test
```

---

## 9. Implementation todos

- [ ] **T1** — Reproduce: open viewer, Tab jumps to Save/browser — note “before” behavior.
- [ ] **T2** — Add `@codemirror/commands` to `package.json`; `npm install`.
- [ ] **T3** — Implement `fileEditorKeymapExtensions()` in `src/ui/file-editor-extensions.ts` (`indentWithTab`, `indentUnit.of('  ')`, Escape blur).
- [ ] **T4** — Wire into `mountEditor()` in `src/ui/file-viewer.ts` (merge with Mod-s keymap).
- [ ] **T5** — Add `test/file/file-editor-keymap.test.mjs` (Tab indent + Escape blur).
- [ ] **T6** — Run `npm run build` and full `npm test`.
- [ ] **T7** — Manual QA §8.2 (including LSP completion Tab).
- [ ] **T8** — Update `documentation/context.md` File panel (Step 11) after merge.
- [ ] **T9** — Create [`documentation/plans/verification/feature-27.md`](../verification/feature-27.md); record plan + implementation sign-off.

---

## 10. Risks and decisions

| Topic | Decision |
| --- | --- |
| **WCAG keyboard trap** | Bind Tab but document **Escape blurs** + built-in Escape-then-Tab; acceptable for dev-tool file editor |
| **`defaultTabBehavior`** | Map to `indentWithTab` only — not a literal CM option |
| **Dependency** | Add `@codemirror/commands` explicitly (not transitive today) |
| **Tab size** | Hardcode `indentUnit` 2 spaces in v1 |
| **Escape vs simplifySelection** | Prefer explicit blur binding for product “Esc still blurs” |
| **feature-26** | No shared code beyond `file-viewer.ts` mount order |

---

## 11. Verifier handoff

Create [`documentation/plans/verification/feature-27.md`](../verification/feature-27.md):

- **Plan review:** E5 goal mapping, template sections 1–6, key files, wave/dependencies.
- **Automated:** `npm install`, `npm run build`, `npm test`; focused `npm test -- test/file/file-editor-keymap.test.mjs test/file/file-viewer-save.test.mjs`
- **Manual:** §8.2 steps M1–M8 (mirror §7 acceptance)
- **Sign-off:** **PASS** only if §7 criteria and manual checks pass; plan review **PASS** does not imply implementation complete.

---

## 12. References

- Backlog: [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — E5
- User notes: [`documentation/plans/to-fix.md`](../to-fix.md) L27
- Context: [`documentation/context.md`](../../context.md) — File panel (Step 11)
- CodeMirror Tab example: https://codemirror.net/examples/tab/
- `indentWithTab`: https://codemirror.net/docs/ref/#commands.indentWithTab
- Viewer: [`src/ui/file-viewer.ts`](../../../src/ui/file-viewer.ts)
- Extensions: [`src/ui/file-editor-extensions.ts`](../../../src/ui/file-editor-extensions.ts)
- Tests: [`test/file/file-viewer-save.test.mjs`](../../../test/file/file-viewer-save.test.mjs)
