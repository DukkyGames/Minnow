# Tool audit — smoke test findings and fix plan

Status: proposed
Date: 2026-09-06
Scope: Full tool-surface smoke test (read-only + safe mutations with cleanup) against the live app on Win32, then root-cause review of failures.

## What was tested

Every tool was exercised once where safe. Categories: utility, web, docs, files (read + write round-trips), git (read), code exec, background commands, dev-server registry, issues (full lifecycle), brain (search/list/read/write/delete), settings (search/read), recall, LSP, code intel, browser preview, Context7, fixture MCP, impeccable, sub-agents, clipboard. Skipped (out of scope by user choice): git writes, settings writes, mode switches, app launching, browser navigation/click automation.

## Smoke test results

**All green (60+ tools):** `get_datetime`, `calculate`, `get_system_info`, `read_clipboard`, `list_directory`, `web_search`, `wikipedia_search` (retry with simpler query), `fetch_web_content`, `rag_web_content`, `minnow_docs_search/read/list`, `read_file`, `read_file_range`, `read_document` (docx/xlsx/pdf round-trip via the creators), `get_file_metadata`, `search_in_file`, `grep`, `find_files`, `git_status`, `git_log`, `git_branch`, `git_diff`, `execute_command`, `run_javascript`, `run_python`, `save_file`, `append_file`, `insert_at_line`, `replace_text_in_file`, `move_file`, `copy_file`, `delete_path`, `create_pdf`, `create_spreadsheet`, `create_word_document`, `execute_command` (background) + `read_command_log` + `stop_command`, `start_background_command` + `list_running_commands` + `stop_background_command`, `manage_dev_servers` (list), `issue_add/update/comment/link/assign/move/unlink/delete/search/get_state`, `brain_search`, `brain_list`, `brain_read_page`, `brain_write_page`, `manage_brain` (delete_page), `search_settings`, `list_lsp_servers`, `get_lsp_diagnostics`, `find_symbol`, `read_symbol`, `who_calls`, `explain_symbol`, `repo_map`, `load_impeccable_context`, `browser_list`, `browser_new_tab`, `browser_snapshot`, `browser_eval`, `browser_close_tab`, `mcp__context7__resolve_library_id`, `mcp__context7__query_docs`, `mcp__fixture__echo`, `spawn_sub_agent` (explore, completed), `list_sub_agents`, `get_sub_agent_status`, `recall_chat_context`, `recall_turn_full`, `ask_question`.

**Failures / issues found (details below):**

| # | Tool / surface | Result | Severity |
|---|---|---|---|
| F1 | `write_clipboard` | Error: `could not write clipboard (Document is not focused)` | Bug |
| F2 | README.md, manual `tools-and-permissions.md` | Claim **106** built-in tools; catalog has **105** | Docs |
| F3 | `get_settings` (section-only field) | Misleading "cannot be read while Minnow is offline" | Copy |
| F4 | manual `modes.md` | Still documents deleted `delegate_tasks` | Docs (known, MIN-193) |
| F5 | `load_aesthetics_reference` | Returns TODO(human) stub, every section empty | Content |
| F6 | `run_impeccable detect` | Ran with no output on a trivial target; inconclusive | Investigate |
| F7 | `issue_move` / `issue_unlink` | Schemas give no way to discover valid status ids / param shape | UX |
| F8 | `execute_command` (Win32) | Quote mangling via cmd.exe path — already filed as **MIN-269** with plan | Known bug |
| F9 | Brain page `minnow/tools/catalog.md` | Stale "114-tool catalog" | Docs (memory) |

Non-issues: `run_javascript` rejects top-level `return` (node -e semantics, documented behavior); `recall_turn_full` returns entire turns by design (token-heavy — use sparingly); `wikipedia_search` is query-phrasing sensitive.

---

## F1 — `write_clipboard` fails without document focus (bug)

### Symptom

`write_clipboard` returns `Error: could not write clipboard (Failed to execute 'writeText' on 'Clipboard': Document is not focused.)` in the Electron shell. `read_clipboard` worked in the same session.

### Root cause

`src/tools/browser-executor.ts:377-394` — both clipboard tools use the Async Clipboard API:

```ts
await navigator.clipboard.writeText(text);
```

In Chromium/Electron, `navigator.clipboard.writeText()` throws `NotAllowedError: Document is not focused` when the `WebContents` does not hold focus (tool execution often happens while the window is backgrounded or focus moved). `readText` succeeded because reading is permitted under the same conditions in this shell — the failure is write-specific but focus-dependent in general. The string is native Chromium text; there is no app-side guard or fallback.

The main process already imports `clipboard` (`electron/preview-context-menu.ts:3,263,284`), but **no preload bridge exposes it to the renderer**, so the tools cannot use the focus-independent native path.

### Fix

1. **Preload bridge** — in the Electron preload (`electron/preload.ts` or equivalent), expose via `contextBridge`:

   ```ts
   contextBridge.exposeInMainWorld('minnowShell', {
     clipboardReadText: () => clipboard.readText(),
     clipboardWriteText: (text: string) => clipboard.writeText(text),
   });
   ```

2. **Tool fallback** — in `toolReadClipboard` / `toolWriteClipboard` (`src/tools/browser-executor.ts`), prefer the bridge when present:

   ```ts
   const shell = (window as any).minnowShell;
   if (shell?.clipboardWriteText) {
     shell.clipboardWriteText(text);
     return `Copied ${text.length} character(s) to the clipboard`;
   }
   ```

   Keep the `navigator.clipboard` path as the plain-browser fallback (Vite-only dev, non-Electron).

3. **Type** — add a `MinnowShell` interface for the bridge (check existing `electron/preload` typing conventions) so `window.minnowShell` is typed.

### Tests

- `test/tools/browser-executor.test.mts` (or nearest existing executor suite): stub `window.minnowShell` → write path uses it and never calls `navigator.clipboard`; absent bridge → falls back and surfaces the native error.
- Manual: run the app, background the window, call `write_clipboard`, confirm success; read back via `read_clipboard`.

---

## F2 — Tool-count doc drift: 106 vs 105 (docs)

`grep -c "^    id: '" src/tools/definitions.ts` → **105** entries in `BUILT_IN_TOOLS` (matches AGENTS.md and context.md).

Stale **106**:
- `README.md` ("Behind it, **106 built-in tools**")
- `documentation/manual/concepts/tools-and-permissions.md` ("Minnow ships 106 of them")

Fix: change both to 105. Brain page `minnow/tools/catalog.md` says 114 (F9) — update or delete that memory page in the same pass.

---

## F3 — `get_settings` blames "offline" for section-only fields (copy bug)

`server/settings/read.js:13-18`:

```js
if (field.storage === 'section' || field.storage === 'browser') {
  return { error: `Field "${field.key}" is ${field.storage}-only and cannot be read while Minnow is offline. ...` };
}
```

The server just answered the request, so "offline" is wrong and misleading — the user checks connectivity when the real issue is that the field is only readable as part of its Settings section.

Fix the copy to:

```
Field "${field.key}" is ${field.storage}-only and can only be read through the Settings UI. Read the whole "${area}" section instead.
```

(Or, better, make the read path fall back to returning the whole section for section-only fields — that is a behavior change; do it only if cheap.)

---

## F4 — Manual documents deleted `delegate_tasks` (docs, known)

`documentation/manual/concepts/modes.md` (Orchestrate row) says it "can call `delegate_tasks`" — that tool was deleted (V1 board tools removed, MIN-715; already tracked in MIN-193 Phase E). Fix the sentence to describe delegation through the board without naming the tool.

---

## F5 — `load_aesthetics_reference` returns an empty stub (content)

`src/design/reference/frontend-aesthetics.md` is a deliberate frozen extract with `TODO(human)` in every section; the tool returns it verbatim. Options:
- Author the sections from the cookbook (the file says human-reviewed, not scraped), or
- Remove the tool from the shipped catalog until content exists.

Recommendation: keep the tool, author at least the core sections (Visual hierarchy, Color systems, Type pairing) — the tool is consumed by Studio/UI work.

---

## F6 — `run_impeccable detect` silent no-output (investigate)

`run_impeccable detect .tool-audit-tmp` (a 5-file dir with a trivial `index.html`) returned `(no output; cwd .)` — exit code 0, no findings, and the reported cwd was the workspace root, not the target. Either detect found nothing (plausible) or the target argument is ignored. Re-run on a fixture with a known anti-pattern (e.g. inline styles / missing alt) to distinguish. If the target is ignored, that is a bug in the `run_impeccable` handler or CLI arg plumbing.

---

## F7 — Issue tool schema discoverability (UX)

- `issue_move.status`: `{ type: 'string', description: 'Destination status id' }` — no pointer to where ids come from. `issue_get_state` returns issues, not the taxonomy, so an agent cannot discover valid ids without guessing or reading source.
- `issue_unlink` takes bare `path`/`ref`/`target_issue_id`/`chat_id`, but `issue_link` takes structured `code_refs` — the asymmetry is documented per-schema but easy to trip on (this audit did).

Fix options (pick one, keep it small):
1. Extend `issue_get_state` to include the taxonomy (statuses/types/priorities) when `scope: all` or a new flag — makes status ids discoverable end-to-end.
2. Add the taxonomy ids to the `issue_move.status` description text (static default ids, since the taxonomy is editable — weaker).
3. Accept structured `code_refs` in `issue_unlink` for symmetry with `issue_link`.

---

## F8 — `execute_command` Windows quote mangling (known, MIN-269)

Already filed as **MIN-269** with root cause and verified fix in `documentation/plans/windows-execute-command-quoting.md` (untracked plan on this branch). The recommended fix — `winOneShot` returns `{ command, args: [], shell: true }` so Node builds cmd-aware quoting — should be implemented and tested (see that plan for evidence). This audit independently reproduced the symptom class (PowerShell default profile + `cmd.exe /d /s /c` spawn path).

---

## Suggested implementation order

1. **F1** clipboard bridge (real functional bug; small, self-contained)
2. **F8** execute_command quoting per existing plan (real functional bug on Win32; plan exists)
3. **F3** settings error copy (one line)
4. **F2 + F4** doc drift (one commit, searchable)
5. **F7** issue schema discoverability (small)
6. **F6** impeccable detect target verification (investigate, then decide)
7. **F5** aesthetics reference authoring (content work; sizeable — schedule separately)
8. **F9** brain catalog page update

## Verification

- `npx tsc --noEmit`
- Scoped suites: `npm run test:tools` (or `node --test --test-force-exit test/tools/`), `test/settings/*`, `test/terminal/*` (F8), `test/issues/*` (F7)
- Manual: backgrounded-window `write_clipboard`; `get_settings` on a section-only key reads as a section; `npm test` green for touched areas
- Re-run this audit's smoke script to confirm F1/F6 resolve

## Files to touch

- `electron/preload.ts` (bridge) + `src/tools/browser-executor.ts` (fallback) + renderer types — F1
- `server/terminal/one-shot-spawn.js` (+ `server/process-runner.js` if needed) — F8
- `server/settings/read.js` — F3
- `README.md`, `documentation/manual/concepts/tools-and-permissions.md`, `documentation/manual/concepts/modes.md` — F2/F4
- `src/tools/definitions.ts` (descriptions), `src/state/issues-store.ts` or `issue_get_state` handler (taxonomy exposure) — F7
- `src/design/reference/frontend-aesthetics.md` — F5