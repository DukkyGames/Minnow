---
name: POLISH-019 — General / Chat mode
overview: Add a lightweight General (or Chat) composer operating mode with a lighter system prompt and narrower tool policy for everyday Q&A, distinct from Build/Plan/Orchestrate/Research/Reef.
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-019)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/context.md (Operating modes section)
  - documentation/plans/references/mode-sources.md
  - POLISH-020 — Merge Reef into General + Research (remove Reef as standalone mode)
  - POLISH-018 — Plan mode intent picker (orthogonal)
status: approved
linear: MIN-82
todos:
  - id: product-naming-order
    content: Decide mode id (`general` vs `chat`), picker label, segment order, and whether new chats default to General vs Build
    status: pending
  - id: tool-policy-matrix
    content: Lock deny/allow list for General (read vs write vs shell vs git vs sub-agents vs browser) vs Build and Research
    status: pending
  - id: registry-prompts
    content: Add ModeId + ModeDefinition in registry.ts; author general.full.md and general.lite.md with MINNOW_MODE_MARKER
    status: pending
  - id: work-agent-default
    content: Decide default work agent (new general agent vs default passthrough) and defaultForModes in work-agents
    status: pending
  - id: handoff-benchmark-server
    content: Extend MODE_HANDOFF_MODE_IDS, HANDOFF_MODES, benchmark modes suite, server/config/validators.js MODE_IDS
    status: pending
  - id: mode-selector-ux
    content: Confirm segmented control fits six segments; CSS/aria if needed; optional empty-state copy for General
    status: pending
  - id: tests-docs
    content: Extend test/modes/* and load-mode-prompt; update context.md, AGENTS.md, bug-hunt status when shipped
    status: pending
  - id: coordinate-polish-020
    content: Sequence with POLISH-020 (Reef removal) — reef prompt content vs general authoring rules
    status: pending
isProject: false
---

# POLISH-019 — General / Chat mode

**Tracker:** [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — POLISH-019  
**Type:** Product polish / composer modes  
**Area:** Operating mode registry, mode prompts, tool policy, composer segmented control, prompt composition, mode handoff tools  
**Status:** Open (plan only — no implementation in this document)

---

## Summary

Minnow today exposes **five** primary composer modes — **Build**, **Plan**, **Orchestrate**, **Research**, and **Reef** — each with a prescriptive mode prompt and (except Build/Reef) tailored tool denials. There is **no** mode optimized for lightweight conversation: explanations, brainstorming, casual Q&A, or “just talk” without implying implementation, planning, orchestration, or research pipelines.

**POLISH-019** adds a **General** (name TBD: **Chat**) mode: a **lighter system prompt** and a **narrower tool allowlist** (product decision) so users have an obvious fallback when they do not need a specialized workflow.

**Related but separate:** **POLISH-020** (bug hunt — merge Reef into General + Research; dedicated plan not written yet) removes **Reef** as a standalone mode and folds widget authoring into General + Research. This document focuses on **adding General**; sequencing with POLISH-020 is called out in [Coordination with POLISH-020](#coordination-with-polish-020).

---

## Problem statement

| | |
|---|---|
| **User need** | Everyday conversation without Build’s implementation discipline, Plan’s write restrictions, Orchestrate’s board/plan UX, or Research’s multi-phase researcher pipeline. |
| **Today** | Users stay in **Build** (default `modeId: build` on new chats) and inherit “implement precisely / all tools” tone, or pick **Research** and get read-only + heavy research protocol. |
| **Gap** | No mode whose **primary job** is conversational assistance with proportionate tooling. |
| **Success** | Mode appears in picker; prompt and tools match intent; handoff tools can suggest General; docs and tests list six primaries (until POLISH-020 removes Reef). |

---

## Current state (codebase)

### Mode registry (`src/chat/modes/`)

| File | Role |
|------|------|
| [`registry.ts`](../../../src/chat/modes/registry.ts) | `MODE_DEFINITIONS`: build, plan, orchestrate, research, reef — `listModes()` returns fixed five |
| [`types.ts`](../../../src/chat/modes/types.ts) | `ModeId` union; `DEFAULT_MODE_ID = 'build'`; `normalizeModeId` maps legacy `debug` → `build` |
| [`tool-policy.ts`](../../../src/chat/modes/tool-policy.ts) | `filterToolsByMode()` — per-mode deny list; `ask` → `deny` for API |

**Plan** denies shell, most writes, git (`PLAN_DENIED_TOOLS`). **Research** adds `save_file`, `make_directory`, etc. **Build** and **Reef**: `default: allow`.

### Prompts (`src/chat/prompts/modes/`)

- Shipped bodies: `{id}.full.md` + `{id}.lite.md` with front matter `kind: mode`, `toolPolicy`, `<!-- MINNOW_MODE_MARKER: {id} full|lite -->`.
- **Build lite** (~25 lines): implementation discipline, all tools.
- **Research lite**: strict read-only researcher phases, `spawn_sub_agent` type `researcher` only.
- **Reef lite**: full widget authoring contract (`reef-widget` fences, templates, save modules).
- Composition: [`prompt-composer.ts`](../../../src/chat/prompts/prompt-composer.ts) loads `part: mode` + base + work-agent + tool-usage; **mode handoff** fragment appended for `build`, `plan`, `research`, `orchestrate`, `reef` (`MODE_HANDOFF_MODE_IDS`).

### UI and persistence

- [`mode-selector.ts`](../../../src/ui/mode-selector.ts): builds segments from `listModes()`; `setChatMode()` updates `Chat.modeId`, work agent when `workAgentAuto`, unmounts reef widgets on switch.
- New chats: [`sessions.ts`](../../../src/state/sessions.ts) / [`session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts) set `modeId: DEFAULT_MODE_ID` (`build`).
- Server mirror: [`server/config/validators.js`](../../../server/config/validators.js) `MODE_IDS` + `normalizeModeId` (must stay in sync with client `types.ts`).

### Reef vs mode (relevant to positioning General)

- **Mounting:** `reef-widget` fences mount in **all** modes when closed ([`renderer.ts`](../../../src/markdown/renderer.ts) → `mountReefWidgets`).
- **Authoring:** Prompts and context state only **Reef mode** (or `reef-widget` sub-agent) should **author** new fences; other modes use handoff / `spawn_sub_agent`.
- General mode product intent likely includes **optional** widget authoring (see POLISH-020) without Reef’s standalone mode shell.

### Mode handoff tools

- [`mode-handoff-tools.ts`](../../../src/tools/mode-handoff-tools.ts): `HANDOFF_MODES` = plan, build, research, orchestrate, reef.
- [`mode-handoff.md`](../../../src/chat/prompts/tool-usage/mode-handoff.md): presets for plan complete, implement → Build, plan in Build, explainer → Reef widget.

### Benchmark and tests

- [`src/benchmark/suites/modes.ts`](../../../src/benchmark/suites/modes.ts): iterates `listModes()`; per-mode negative/positive tool probes (plan/research negative; build/plan/research/orchestrate/reef positive).
- [`test/modes/load-mode-prompt.test.mts`](../../../test/modes/load-mode-prompt.test.mts): loops `MODE_IDS` (includes `debug`, not in `listModes()`).

### Documentation

- [`documentation/context.md`](../../context.md): “Five primary modes per chat: Build, Plan, Orchestrate, Research, Reef.”
- [`AGENTS.md`](../../../AGENTS.md): “five composer modes.”
- [`documentation/plans/references/mode-sources.md`](../references/mode-sources.md): OpenCode mapping; notes OpenCode **General** subagent as inspiration for **orchestrate** (naming collision to avoid in UX copy).

---

## Desired behavior (from bug hunt)

1. **New mode** in composer mode picker — label **General** or **Chat** (TBD).
2. **Lighter system prompt** — Q&A, explanations, brainstorming; not full build/plan/orchestrate tool policies unless user opts in (via mode switch or handoff).
3. **Default or easy fallback** when user does not need a specialized workflow (implementation detail: new-chat default vs left-most segment vs handoff presets — see [Product decisions](#product-decisions)).

**Explicitly not in POLISH-019 scope alone:** Removing Reef mode (POLISH-020), Plan intent picker (POLISH-018), changing global `maxToolTurns` or sampler presets.

---

## Product decisions

*Resolve before implementation. Record choices in this section when decided.*

### 1. Stable mode id and label

| Option | Id | Label | Pros | Cons |
|--------|-----|-------|------|------|
| **A (recommended)** | `general` | General | Aligns with “general assistant” wording in base prompt; distinct from UI word “chat”; stable for `modeId` in JSON | OpenCode doc maps “General” to orchestrate inspiration — document disambiguation |
| B | `chat` | Chat | Plain user language | Collides with “chat” as thread noun; less precise in logs/API |

**Recommendation:** `general` / **General**. Do not rename without migration (`Chat.modeId`, handoff tools, benchmarks, user prompt overrides at `~/.minnow/prompts/modes/general.*.md`).

### 2. Picker order and default mode for new chats

| Option | Behavior |
|--------|----------|
| **A** | Insert **General** first (left): General \| Build \| Plan \| Orchestrate \| Research \| Reef |
| **B** | Insert after Build: Build \| General \| … |
| **C** | Keep `DEFAULT_MODE_ID = build`; General is opt-in only |
| **D** | Set `DEFAULT_MODE_ID = general` for new empty chats |

**Recommendation:** **A + C** for v1 — General is the obvious first tap for conversation, but **new chats stay Build** until product confirms switching default (avoids surprising developers who expect Build). Revisit after dogfood.

### 3. Tool policy (critical)

General should be **less capable than Build**, not a duplicate. Proposed tiers for discussion:

| Tier | Deny (examples) | Allow (examples) | Analog |
|------|-----------------|-------------------|--------|
| **Strict chat** | All writes, shell, git, `spawn_sub_agent`, board tools, most server mutations | `read_file`, `find_files`, `web_search`, `get_datetime`, `calculate`, `ask_question`, memory read/save? | Research-lite without researcher pipeline |
| **Moderate** | Shell, git, destructive writes, orchestrate/board | Above + selective read-only codebase tools | “Explain this repo” |
| **Permissive** | Only Plan-style destructive tools | Near-Build minus explicit implementation nudges in prompt | Risk: feels like Build with different prompt |

**Recommendation:** Start **Moderate** — deny `PLAN_DENIED_TOOLS` plus orchestration-specific tools (`spawn_sub_agent`, `create_sub_agent`, `board_*`, `report_orchestrator_status`, `set_chat_mode` optional). **Allow** read/search/utility and **mode handoff** tools so the model can offer Build/Plan when user asks to implement. **Do not** allow silent file edits in General.

Exact deny list: produce a table in implementation PR from [`definitions.ts`](../../../src/tools/definitions.ts) grouped by category (read / write / shell / git / orchestration / browser / reef).

### 4. Work agent default

| Option | Behavior |
|--------|----------|
| A | New work agent `general` with `defaultForModes: [general]` — conversational tone |
| B | `default` work agent (passthrough) when `workAgentAuto` |
| C | Reuse `creative-writer` or similar expert-adjacent agent |

**Recommendation:** **A** — small `work-agents/general/agent.{full,lite}.md` focused on clarity and proportionate tool use; avoids Builder prompt leaking in auto mode.

### 5. Mode handoff copy

Update [`mode-handoff.md`](../../../src/chat/prompts/tool-usage/mode-handoff.md) and `propose_mode_switch` presets:

- User asks to **implement** while in General → offer **Switch to Build**.
- User asks to **plan** → **Switch to Plan**.
- User wants **deep research report** → **Switch to Research**.
- **Reef visualization:** keep “Show as Reef widget” until POLISH-020; after 020, “Add interactive widget” in General without switching to a Reef mode.

Add `general` to `MODE_HANDOFF_MODE_IDS` and `HANDOFF_MODES`.

### 6. Expert picker and skills

No change required for v1 beyond existing global expert/skill parts. General prompt should **not** force a skill; optional line: “Use skills only when the user attaches or requests one.”

---

## Proposed prompt design (outline)

Authors implement full/lite files; this is the contract.

### Tone and goals (`general.lite.md` / `general.full.md`)

- **Primary:** Answer questions, explain concepts, brainstorm, draft prose, compare options.
- **Not primary:** Implement features, write plan files, run orchestration boards, execute multi-agent research pipelines.
- **Tool discipline:** Prefer answering from knowledge; use read/search tools when facts depend on the repo or the web. **Do not** edit project files unless user explicitly requests implementation — then **hand off** to Build (or switch via `set_chat_mode`).
- **Reef (if POLISH-019 ships before 020):** Optional short pointer: “For interactive UI, offer Reef handoff or stay in General if product allows inline widgets post-020.”
- **Markers:** `<!-- MINNOW_MODE_MARKER: general full -->` / `lite`; front matter `toolPolicy` mirrors registry.

### Lite vs full

- **Lite:** &lt; Research lite length; no phase machinery.
- **Full:** Expanded examples (when to hand off, how to cite files, memory guidance consistent with base prompt).

### Interpolation

Same vars as other modes: `{{cwd}}`, `{{enabled_tools}}`, `{{mode_label}}`, etc. ([`prompt-composer.ts`](../../../src/chat/prompts/prompt-composer.ts)).

---

## Implementation plan (phased)

*No code in this document — execution checklist for a follow-up PR.*

### Phase 0 — Product lock (blocking)

- [ ] Confirm id `general`, label **General**, picker order, new-chat default (Build vs General).
- [ ] Sign off tool deny list (Moderate vs Strict).
- [ ] Decide POLISH-019-only vs combined PR with POLISH-020.

### Phase 1 — Registry and prompts

1. [`types.ts`](../../../src/chat/modes/types.ts): add `'general'` to `ModeId` and `MODE_IDS` (order: general first in union if desired).
2. [`registry.ts`](../../../src/chat/modes/registry.ts): `ModeDefinition` entry + `denyListToolPolicy` or custom policy.
3. Add [`general.full.md`](../../../src/chat/prompts/modes/general.full.md) and [`general.lite.md`](../../../src/chat/prompts/modes/general.lite.md).
4. Optional: `_template/general.*.md` stubs per [`modes/_template/README.md`](../../../src/chat/prompts/modes/_template/README.md).

### Phase 2 — Work agent and composition

1. Add `work-agents/general/agent.{full,lite}.md` with `defaultForModes: [general]`.
2. Register id in [`work-agents/registry.json`](../../../src/chat/prompts/work-agents/registry.json) if required.
3. [`prompt-composer.ts`](../../../src/chat/prompts/prompt-composer.ts): add `general` to `MODE_HANDOFF_MODE_IDS`.

### Phase 3 — Handoff, tools, server

1. [`mode-handoff-tools.ts`](../../../src/tools/mode-handoff-tools.ts): `HANDOFF_MODES` + new `propose_mode_switch` situation if needed (e.g. `implement_in_general`).
2. Update [`mode-handoff.md`](../../../src/chat/prompts/tool-usage/mode-handoff.md) table rows.
3. [`server/config/validators.js`](../../../server/config/validators.js): add `general` to `MODE_IDS`.
4. Verify `POST /api/tools` respects `modeId` for any server-side guards (Plan write guard N/A).

### Phase 4 — UI and persistence

1. [`mode-selector.ts`](../../../src/ui/mode-selector.ts): no code change if driven by `listModes()` — verify six segments layout in [`index.html`](../../../index.html) + CSS (`mode-segmented`).
2. Optional: General-specific empty state (like POLISH-018 for Plan) — **out of scope** unless product asks in same PR.
3. `create_chat_with_mode` / sidebar: accept `general` modeId (inherits from `normalizeModeId` once typed).

### Phase 5 — Benchmark and tests

1. [`modes.ts`](../../../src/benchmark/suites/modes.ts): negative probe (e.g. `execute_command` denied); positive probe (e.g. `read_file` or `get_datetime`).
2. [`test/modes/tool-policy.test.mts`](../../../test/modes/tool-policy.test.mts): assertions for general denials.
3. [`load-mode-prompt.test.mts`](../../../test/modes/load-mode-prompt.test.mts): skip `debug` in “primary modes” loop or add `general` to `listModes()` iteration separately.
4. [`test/tools/mode-handoff-tools.test.mjs`](../../../test/tools/mode-handoff-tools.test.mjs): handoff to/from general.
5. Run `npx tsx test/modes/run-all.mts`, `npm test` subset, `npx tsc --noEmit`.

### Phase 6 — Documentation

1. [`documentation/context.md`](../../context.md): mode count, General description, tool policy summary.
2. [`AGENTS.md`](../../../AGENTS.md): composer mode list.
3. [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md): mark POLISH-019 resolved when shipped.
4. Optional: [`mode-sources.md`](../references/mode-sources.md) row for General.

---

## Coordination with POLISH-020

| Topic | POLISH-019 alone | With POLISH-020 |
|-------|------------------|-----------------|
| Mode count | Six primaries (… + General + Reef) | Five: General, Build, Plan, Orchestrate, Research |
| Reef prompt | May reference handoff to Reef mode | Fold reef authoring instructions into `general.*` + `research.*`; remove `reef` from registry |
| `modeId: reef` sessions | Unchanged | Migrate to `general` (or `research`) on `normalizeModeId` / load |
| Widget authoring rules | Keep “only Reef authors” until 020 | General may author widgets when appropriate |
| Benchmark | Add `general` probes; keep `reef` until removed | Drop reef probes; extend general/research |

**Recommendation:** Implement **POLISH-019** first (registry + prompt + policy) so POLISH-020 is mostly deletion/migration + prompt merge. If doing one PR, still land General before removing Reef to avoid a window with only five legacy modes.

*POLISH-020 plan:* [`POLISH-020-merge-reef-mode.md`](POLISH-020-merge-reef-mode.md) (depends on General landing first).

---

## Acceptance criteria

- [ ] **Picker:** `listModes()` includes **General** with label and description; segmented control shows it and persists `Chat.modeId: general`.
- [ ] **Prompt:** `loadModePromptBody('general', 'full'|'lite')` non-empty with correct `MINNOW_MODE_MARKER`.
- [ ] **Tools:** Denied tools are not exposed in `getEnabledToolDefinitionsForMode('general')`; allowed tools work in manual send and benchmark positive probe.
- [ ] **Negative probe:** Model is not offered (or policy blocks) at least one high-risk tool denied in Build (e.g. `execute_command` or `save_file` per signed-off matrix).
- [ ] **Handoff:** `set_chat_mode` / `create_chat_with_mode` accept `general`; handoff docs mention switching from General to Build/Plan/Research.
- [ ] **Work agent:** With `workAgentAuto`, switching to General sets the agreed default agent.
- [ ] **Server:** Session save/load preserves `general`; server validator accepts id.
- [ ] **Tests:** Mode test suite green; no regression in `test/modes/run-all.mts`.
- [ ] **Docs:** context.md + AGENTS.md reflect six modes (or five after 020 if shipped together).

---

## Files to touch (implementation checklist)

| Area | Files |
|------|--------|
| Types / registry | `src/chat/modes/types.ts`, `registry.ts` |
| Prompts | `src/chat/prompts/modes/general.{full,lite}.md`, optional `_template/` |
| Work agent | `src/chat/prompts/work-agents/general/agent.{full,lite}.md`, `registry.json` |
| Composition / handoff | `src/chat/prompts/prompt-composer.ts`, `tool-usage/mode-handoff.md` |
| Tools | `src/tools/mode-handoff-tools.ts`; verify `definitions.ts` ids match deny list |
| Server | `server/config/validators.js` |
| UI | `src/ui/mode-selector.ts` (if needed), styles for `mode-segmented` |
| Benchmark | `src/benchmark/suites/modes.ts` |
| Tests | `test/modes/*.mts`, `test/tools/mode-handoff-tools.test.mjs` |
| Docs | `documentation/context.md`, `AGENTS.md`, bug-hunt session |

**Unlikely to change for POLISH-019 alone:** `src/tools/loop.ts` (uses mode id from chat), Reef mount pipeline, Plan write guard.

---

## Testing strategy

| Layer | Action |
|-------|--------|
| **Unit** | `tool-policy.test.mts` — general denies forbidden, allows read/utility |
| **Prompt** | `load-mode-prompt.test.mts` — general bodies + markers |
| **Compose** | `compose-mode.test.mts` — system prompt includes General mode fragment |
| **Handoff** | `mode-handoff-tools.test.mjs` — `set_chat_mode({ modeId: 'general' })` |
| **Benchmark** | Modes suite general negative/positive (live LLM optional) |
| **Manual** | `npm start` → select General → ask explain question (no file writes); ask “implement X” → handoff offers Build |

---

## Risks and open questions

1. **Segment crowding:** Six (or five post-020) segments on narrow viewports — may need overflow menu or icons-only follow-up (separate polish).
2. **Default mode confusion:** If General is first in picker but new chats are Build, users may expect General — document in release notes.
3. **Tool policy too tight:** Users asking “fix this typo” in General get blocked — prompt must hand off to Build; consider allowing `save_file` only with handoff (not recommended for v1).
4. **MCP / future plugins:** `getEnabledToolDefinitionsForMode` built-ins only today — General policy must extend when feature-17 plugin surface merges into mode filtering.
5. **Sub-agents in General:** Denying `spawn_sub_agent` avoids research/orchestrate leakage; confirm product wants zero sub-agents in General.
6. **Browser CDP tools:** If allowed in General, `browser_*` allowlist rules still apply via `prompt-composer` when tools enabled — align with Research/Build policy.
7. **User prompt overrides:** `~/.minnow/prompts/modes/general.*.md` can override built-in — document for power users.

### Questions for product / QA

- Should **General** allow `save_memory` / long-term memory writes?
- Should **web_search** be allowed in General (offline-only users)?
- Is **Reef widget authoring** in General in scope for POLISH-019, or only after POLISH-020?
- Should benchmark **Quick** preset treat General as a first-class mode row in UI copy?

---

## Out of scope

- Implementing POLISH-020 (remove Reef mode, migrate chats).
- POLISH-018 Plan intent picker UI.
- Changing Build/Plan/Research prompt content except handoff cross-links.
- New tools (e.g. POLISH-021 grep).
- Settings page mode-specific model routing (unless already generic per chat).
- Changing `DEFAULT_MODE_ID` without explicit product approval.

---

## References

- Bug hunt: [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — POLISH-019, POLISH-020
- Architecture: [documentation/context.md](../../context.md) — Operating modes, Reef, send path
- Mode mapping: [documentation/plans/references/mode-sources.md](../references/mode-sources.md)
- Template authoring: [src/chat/prompts/modes/_template/README.md](../../../src/chat/prompts/modes/_template/README.md)
- Related feature (artifacts): [documentation/plans/Build out/feature-04-reef-artifacts.md](../Build%20out/feature-04-reef-artifacts.md)


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-82](https://linear.app/minnowai/issue/MIN-82/polish-019-general-chat-mode)
