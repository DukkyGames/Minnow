# MIN-667 — Tool result truncation (not chat compaction)

Linear: [MIN-667](https://linear.app/minnowai/issue/MIN-667)

## Problem

File, grep, search, and shell results are sliced **at execute time** before they enter history. Agents often cannot see the code they asked for: 32 000 chars per result, 400 chars per line (ellipsizing source even when the whole result is under 32k), grep `head_limit` default **and** max both 200 (raising `head_limit` is a no-op), `find_files` 500 paths, web fetch 24 KB. There is no Settings control and no per-call “give me the rest.”

This is a separate system from **Settings → Agents → Context policy** (summarize / slide / truncate history). Mixing the two makes the product harder to reason about.

## Goal

Keep execute-time capping **on by default**, but:

- Raise the product defaults so typical file/grep/shell results fit.
- Persist a **Tool result size** control on `~/.minnow/tools.json` (`toolOutput.enabled` + `toolOutput.maxChars`).
- Add optional **`full_result`** (also accept `full === true`) so a single call can skip automatic size caps.
- Leave hard memory guards in place (25 MB file refuse, 5 MB process capture with a loud footer, 32 MB POST `/api/tools` body).
- Leave chat context compaction (MIN-39) untouched.

## Todos

- [x] Add `tools.json` `toolOutput { enabled, maxChars }` to types, defaults, and `normalizeToolConfig` with clamps (8 000–2 000 000)
- [x] Raise output-cap defaults (128 000 chars, 2 000 chars/line, grep 500/2000, find_files 2 000, web 128 KB); ALS policy (`enabled === false` or `full_result`/`full` → skip result caps)
- [x] Wire policy through `read_file` / range / document, grep / find_files, `git_diff`, process-runner, terminal-panel streaming, web fetch
- [x] Add `full_result` to capped tool schemas; replace hardcoded 32k / max 200 copy
- [x] Settings → Tools: Tool result size toggle + max chars; catalog, overlay, registry generate; copy vs Context policy
- [x] Tests: disable-on (no silent slice), truncated-vs-full, grep `head_limit`, `normalizeToolConfig`
- [x] Update `documentation/context.md`, tools/context manuals, settings-reference

## Non-goals

- Removing capping (disable is opt-in)
- Changing [`src/chat/context-budget.ts`](../src/chat/context-budget.ts), `apply-policy.ts`, `/compress`, Settings → Agents → Context policy, composer compact layout
- MCP/plugin result wrapping, `repo_map` token_budget, Brain inject caps, issue-list page size, web_search **hit count**
- Skipping explicit pagination: grep `head_limit`/`offset`, `read_file_range` line bounds, `read_command_log` `max_bytes`
- Pretending a 5 MB process capture was complete when truncation is off — keep the accumulation footer
