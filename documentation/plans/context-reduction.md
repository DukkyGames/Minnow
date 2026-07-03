# Outbound context reduction — draft plan (nothing applied)

Goal: cut the per-turn token input (system prompt + tool schemas) without degrading
functionality. Measured baseline for a **Build** agent turn:

| Component | ~tokens |
|---|---|
| System prompt (composed) | 9,854 |
| JSON tool schemas (90 tools) | 10,746 |
| **Total** | **~20,600** |

All token figures are `chars / 4` proxies, consistent with `token-estimate-core.ts`.

---

## Decisions locked (from review)

1. **Remove both in-prompt `{{enabled_tools}}` dumps entirely** — the JSON schemas already
   carry every tool's name/description/params.
2. **Per-mode tool allowlists — aggressive**, driven by the full matrix below.
3. **Scope the orchestrator board agents (build / test / fix)** to their own toolsets.
4. **Gate `browser-allowlist`** to first browser-tool use.
5. **Draft everything first; apply nothing yet.** ← this document.

---

## Wave 1 — kill the duplicated tool lists (safe, ~3,800 tok)

The full `id: description` list of all enabled tools renders **twice** in the system prompt:

- `modes/build.full.md` → `## Session context` → `Enabled tools: …` (via `{{enabled_tools}}`)
- `tool-usage/default.full.md:16` → `### Available tools` (via `{{enabled_tools}}`)

…and a third time as the JSON `tools` array (mandatory — the model calls tools from this).

**Change:** remove the `{{enabled_tools}}` interpolation from both markdown files. Drop the
`enabled_tools` var wiring in `prompt-composer.ts` / `compose-context.ts`
(`formatEnabledToolsFull` / `formatEnabledToolsLite` become dead — remove).

**Saves:** ~3,800 tok/turn. **Risk:** none (JSON schemas unchanged).

---

## Wave 2 — per-mode tool allowlists (the big lever, ~2,400–4,700 tok)

Today `general`, `build`, `reef`, `debug` all use `toolPolicy: { default: 'allow' }`
(`chat/modes/registry.ts`) → all 90 tools ship. Proposed: switch each mode to an explicit
group allowlist. Group → token cost (JSON):

| Group | tok | Tools |
|---|---|---|
| util-basic | 272 | get_datetime, calculate, get_system_info, read/write_clipboard |
| web | 355 | web_search, wikipedia_search, fetch_web_content, rag_web_content |
| files-read | 829 | list_directory, read_file, read_file_range, find_files, get_file_metadata, search_in_file, grep |
| files-write | 843 | save_file, append_file, insert_at_line, replace_text_in_file, make_directory, move_file, copy_file, delete_path |
| git-read | 172 | git_status, git_diff, git_log |
| git-write | 201 | git_add, git_commit, git_checkout |
| code-exec | 985 | execute_command, read_command_log, list_running_commands, stop_command, start/stop_background_command, run_javascript, run_python |
| code-intel | 551 | repo_map, find_symbol, who_calls, read_symbol, explain_symbol |
| lsp | 123 | get_lsp_diagnostics, list_lsp_servers |
| sub-agents | 425 | spawn_sub_agent, cancel_sub_agent, list_sub_agents, get_sub_agent_status |
| board | 991 | board_init, board_update_task, board_set_autonomy, board_get_state, board_report, delegate_tasks |
| bug-board | 290 | bug_add, bug_update, bug_get_state |
| mode-mgmt | 668 | set_chat_mode, create_chat_with_mode, launch_minnow_app, propose_mode_switch |
| ask | 655 | ask_question |
| browser | 603 | browser_list/navigate/snapshot/click/fill/eval/screenshot, request_browser_origin_access |
| brain | 1,161 | brain_search/read_page/list/write_page/append_log/ingest_source, manage_brain, save_memory |
| recall | 271 | recall_chat_context, recall_turn_full |
| email | 624 | list_mail, draft_reply, summarize_inbox, generate_reply_variants, email_action |
| calendar | 429 | manage_calendar |
| reef | 94 | check_reef_widget |
| impeccable | 194 | load_impeccable_context, run_impeccable |
| **total** | **10,736** | |

### Proposed mode × group matrix

● keep · ○ drop · ? = needs your call

| Group (tok) | General | Build | Plan | Orchestrate | Reef | Debug |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| util-basic (272) | ● | ● | ● | ● | ● | ● |
| web (355) | ● | ● | ● | ○ | ○ | ● |
| files-read (829) | ● | ● | ● | ● | ● | ● |
| files-write (843) | ● | ● | ●¹ | ○ | ● | ● |
| git-read (172) | ● | ● | ● | ● | ○ | ● |
| git-write (201) | ● | ● | ○ | ○ | ○ | ● |
| code-exec (985) | ● | ● | ● | ○ | ○ | ● |
| code-intel (551) | ● | ● | ● | ● | ○ | ● |
| lsp (123) | ● | ● | ● | ○ | ○ | ● |
| sub-agents (425) | ● | ● | ● | ○² | ○ | ● |
| board (991) | ○ | ○ | ○ | ● | ○ | ○ |
| bug-board (290) | ● | ○ | ○ | ○ | ○ | ● |
| mode-mgmt (668) | ● | ●³ | ● | ● | ●³ | ● |
| ask (655) | ● | ● | ● | ● | ● | ● |
| browser (603) | ● | ●⁴ | ● | ○ | ● | ● |
| brain (1,161) | ● | ● | ● | ● | ● | ● |
| recall (271) | ● | ● | ● | ● | ○ | ● |
| email (624) | ○ | ○ | ○ | ○ | ○ | ○ |
| calendar (429) | ○ | ○ | ○ | ○ | ○ | ○ |
| reef (94) | ○ | ○ | ○ | ○ | ● | ○ |
| impeccable (194) | ● | ● | ● | ○ | ● | ● |

Notes / decision points:
1. **Plan files-write** — planner writes the plan doc; keep `save_file` + `make_directory`
   but not the mutating edit tools (matches current `PLAN_DENIED_TOOLS`).
2. **Orchestrate sub-agents** — mode already denies `spawn_sub_agent`/`cancel_sub_agent`.
3. **mode-mgmt in Build/Reef** — build/reef handoff prompts use `propose_mode_switch`,
   `set_chat_mode`, `create_chat_with_mode`; `launch_minnow_app` is General-only (gated
   separately in composer). Could drop `launch_minnow_app` everywhere but General.
4. **Build browser** — kept because Build verifies UI via preview; pairs with Wave 3 gating.
5. **brain (1,161 tok)** — biggest single group. Already server-gated (`serverRequired`), so
   only ships when `npm start` is up. Open question: expose the **read subset**
   (`brain_search`, `brain_read_page`, `brain_list`, `recall_*`, `save_memory` ≈ 570 tok)
   in most modes and reserve write/`manage_brain` for Build/Debug? Marked ? where debatable.

**Email + calendar are dropped from every chat mode** — they belong to the Email/Calendar
apps, not code chat. (~1,050 tok off every mode.)

### Illustrative savings (Build mode)
Dropping board + bug + email + calendar + reef from Build = **−2,428 tok** (safe floor).
Adding brain-write/manage trim (keep read subset) ≈ **−590** more. Build tool payload
10,746 → ~7,700.

### Implementation shape
- Extend `ModeToolPolicy` usage: replace `{ default: 'allow' }` with
  `{ default: 'deny', tools: { <allowed>: 'allow' } }` per mode, OR add a group→ids
  expansion helper so the registry stays readable.
- Keep `bug_*` always-allow override? Currently `tool-policy.ts:9` force-allows bug tools in
  **all** modes — revisit: they should be Debug-only. (Removing that override is part of this
  wave.)
- Tests: `test/modes/tool-policy.test.mts` already asserts per-mode gating — extend it.

---

## Wave 2b — scope the board agents (build / test / fix)

Today (`orchestrate-board-actions.ts`):
- tester chat → `workAgentId = 'tester'` → scoped to ~19 tools ✅
- builder chat → `workAgentId = null` → **all mode tools** ❌
- fixer chat → `workAgentId = null` → **all mode tools** ❌

`applyBoardMemberToolFilter` (`chat/modes/orchestrate-tool-filter.ts`) only strips 4 board
tools + (hands-off) `ask_question`/`propose_mode_switch` — it does **not** cap the rest.

**Proposed:** give each board role an explicit allowlist, enforced for any chat with a
`boardTaskId`. Cleanest: extend `applyBoardMemberToolFilter` to intersect with a per-role
set keyed off `chat.workAgentId` / `fixerKind`, so no agent-resolution changes are needed.

| Role | Allowed groups | ~tok | vs 90-tool baseline |
|---|---|--:|--:|
| **Builder** (build) | util-basic, web, files-read, files-write, git-read, git-write, code-exec, code-intel, lsp, browser, `board_get_state`, `board_report` | ~5,200 | −5,550 |
| **Tester** (test) | util-basic, web, files-read, git-read, git-write, code-exec, code-intel, lsp, browser, `board_get_state`, `board_report` | ~4,350 | −6,400 |
| **Fixer** (fix) | same as Builder but **no browser** | ~4,600 | −6,150 |

### Board-agent × group matrix

Same groups as the mode matrix above. ● keep · ○ drop · ◐ subset (see notes).

| Group (tok) | Builder | Tester | Fixer |
|---|:--:|:--:|:--:|
| util-basic (272) | ● | ● | ● |
| web (355) | ● | ● | ● |
| files-read (829) | ● | ● | ● |
| files-write (843) | ● | ○ | ● |
| git-read (172) | ● | ● | ● |
| git-write (201) | ● | ● | ● |
| code-exec (985) | ● | ● | ● |
| code-intel (551) | ● | ● | ● |
| lsp (123) | ● | ● | ● |
| sub-agents (425) | ○ | ○ | ○ |
| board (991) | ◐ᶜ | ◐ᶜ | ◐ᶜ |
| bug-board (290) | ○ | ○ | ○ |
| mode-mgmt (668) | ○ | ○ | ○ |
| ask (655) | ○ᵈ | ○ᵈ | ○ᵈ |
| browser (603) | ● | ● | ○  |
| brain (1,161) | ○ | ○ | ○ |
| recall (271) | ○ | ○ | ○ |
| email (624) | ○ | ○ | ○ |
| calendar (429) | ○ | ○ | ○ |
| reef (94) | ○ | ○ | ○ |
| impeccable (194) | ○ | ○ | ○ |
| **≈ total** | **~5,200** | **~4,350** | **~4,600** |

Subset notes:
- ᶜ **board (all roles)** — only `board_get_state` (38) + `board_report` (225) ≈ 263 tok; the
  mutating tools (`board_init`/`board_update_task`/`board_set_autonomy`/`delegate_tasks`) stay
  stripped by `applyBoardMemberToolFilter`.
- ᵈ **ask** — excluded from the scoped set. Note this is stricter than today, where
  `ask_question` is only stripped in hands-off (auto/afk). Confirm whether board members should
  keep `ask_question` in **manual/sequential** mode.

Group tokens are the full-group cost; ◐ rows contribute only their subset (board), so the
per-role totals are lower than a naive sum of the ● groups.

Resolved (see MIN-333):
- **All three roles** get web + git-write + code-exec + code-intel + lsp per the matrix.
- **Fixer** — single scope for both `merge` and `env` fixers; same as Builder **but no browser**.
- **Builder / Tester** keep browser (verification); board mutate tools, sub-agents, bug,
  mode-mgmt, ask, brain, recall, email, calendar, reef, impeccable excluded from all roles.

**Saves:** builder + fixer tool payloads drop from ~10.7K to ~4.6–5.2K each. Combined with
Wave 1's prompt trims and the shorter builder mode prompt, a builder turn goes ~20K → ~9.8K.

---

## Wave 3 — gate `browser-allowlist` to first use (~700 tok)

`browser-allowlist.md` (711 tok) currently renders on **every** Build turn (browser tools are
enabled by default), even when nothing browses. `mode-handoff` fires similarly.

**Change:** in `prompt-composer.ts`, only append `resolveBrowserAllowlistBody` when a browser
tool has actually been invoked in this chat (track a `chat` flag / scan history for a
`browser_*` tool call), OR always use the ~120-tok lite fragment. Recommended: first-use gate,
fall back to lite before first use.

**Saves:** ~700 tok on the majority of turns. **Risk:** low — the rules are only needed the
moment a browser tool runs; the tool descriptions themselves still explain the allowlist.

---

## Wave 4 — collapse cross-section overlap (~400 tok)

Same guidance repeated across parts that always ship together:
- "Read before write / never invent tool output / smallest correct change" appears in
  `base` §Core behavior, `build` §Implementation discipline, **and** `tool-usage` §Core rules.
  Keep the canonical copy in `tool-usage`; trim the echoes in base/mode.
- **Session context** (`cwd`, `date`) interpolated in `base`, `build`, **and**
  `general-assistant` info block — keep once (base).
- `ask_question` rules stated 3× (`tool-usage` §Structured questions,
  `ask-question-enforcement.md`, and the 655-tok tool schema). Keep the tool schema as
  authoritative; collapse the two prompt copies into one short pointer.
- `mode-handoff` stated 2× (`tool-usage` §Mode handoff paragraph + appended handoff table).

**Change:** edit the markdown parts to remove the echoes; leave one authoritative statement
of each rule.

**Saves:** ~400 tok. **Risk:** low (wording only; keep the strongest phrasing).

---

## Wave 5 — trim verbose tool schema descriptions (~500–800 tok)

Param descriptions total 2,064 tok. Worst offenders and target trims:

| Tool | now | target | note |
|---|--:|--:|---|
| ask_question | 655 | ~150 | JSON shape lives in prompt too; keep field names + 1-line example |
| manage_calendar | 429 | ~180 | verbose enum prose → terse |
| execute_command | 369 | ~220 | background/timeout guidance is also in tool-usage |
| board_init | 359 | ~200 | |
| grep | 337 | ~220 | |
| manage_brain | 293 | ~180 | |

**Saves:** ~500–800 tok. **Risk:** low, but validate the model still calls each tool with the
right shape (there are prompt tests for `ask_question`).

---

## Wave 6 — architectural (future, not this pass)

- **Lazy tool loading** (deferred tools + a `search_tools` meta-tool, like the Claude Code
  harness). Could take the 10.7K tool payload to ~3–4K. Caveat: local models handle
  deferred-tool patterns poorly and it adds a round-trip. Revisit after Waves 1–5.
- **Auto-select the existing `lite` profile by model context length.** Lite templates +
  truncation caps already exist; wiring small-context local models to `lite` roughly halves
  the system prompt for the models that need it most.

---

## Roll-up (Build agent turn)

| Stage | System | Tools | Total | Δ |
|---|--:|--:|--:|--:|
| Today | 9,854 | 10,746 | 20,600 | — |
| + Wave 1 | 6,050 | 10,746 | 16,800 | −3,800 |
| + Wave 2 (build allowlist) | 6,050 | ~7,700 | 13,750 | −3,050 |
| + Waves 3–5 | ~4,600 | ~7,100 | 11,700 | −2,050 |
| Builder board agent (Wave 2b) | ~4,600 | ~5,200 | **~9,800** | vs 20,600 |
| + Wave 6 (lazy tools) | ~4,600 | ~3,500 | ~8,100 | later |

Interactive Build ≈ **20.6K → ~11.7K (−43%)**; a scoped builder board agent ≈ **~9.8K (−52%)**
— all with no capability the mode/agent actually uses removed.

---

## Resolved decisions

1. **General mode = broad** — keeps files-write + code-exec (matrix `?` cells → ●).
2. **Brain = left as-is** — no read-subset split; brain gating unchanged by this work
   (● everywhere it currently resolves).
3. **Fixer = single scope for merge + env**, and the fixer gets **git-write** so the merge
   fixer can commit conflict resolutions. Builder stays web-off and brain-write-off.
4. **Bug tools = General + Debug only** — drop the global `bug_*` force-allow
   (`tool-policy.ts:9`); re-add bug-board to General + Debug allowlists explicitly.

Still to confirm during implementation:

- **Registry ergonomics** — express allowlists as tool-id lists, or add a group→ids helper so
  `registry.ts` stays readable (recommended: `src/chat/modes/tool-groups.ts`). ✅ Done (MIN-332).
- **Tester source of truth** — keep tester's `allowedTools` front matter, or migrate all three
  board roles into one `BOARD_ROLE_ALLOWED_TOOLS` map (recommended).
- **Plan code-exec** — kept per final matrix (MIN-332); shell runs allowed for planning probes.

## Linear

Project **Input Token Reduction** (Minnow AI) — issues MIN-331…MIN-337, one per phase.
