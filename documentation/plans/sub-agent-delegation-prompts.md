# Sub-agent delegation prompts (Build / General / Plan / Debug)

## Problem

Sub-agent guidance was inconsistent across modes:

- **Build** and **General** documented `wait: false` mechanics but not **when** to delegate.
- **Plan** allowed Researcher spawns in one line but lite had nothing.
- **Debug** described the bug pipeline only; no guidance for ad-hoc research/build delegation.
- Duplicating a full delegation table across 8 mode files would bloat tokens.

## Solution

A shared **sub-agent-delegation** tool-usage fragment (mirroring `mode-handoff`), wired into `composeSystemPrompt()` for build, general, plan, and debug when `spawn_sub_agent` is in `enabledToolIds`.

### Files

| File | Purpose |
|------|---------|
| `src/chat/prompts/tool-usage/sub-agent-delegation.md` | Full fragment (~15 lines): when, mechanics, type table, task brief |
| `src/chat/prompts/tool-usage/sub-agent-delegation.lite.md` | Lite compressed bullets |
| `src/chat/prompts/prompt-composer.ts` | `resolveSubAgentDelegationBody()` — after handoff, before browser |
| `src/tools/definitions.ts` | Extended `spawn_sub_agent` `type` enum hint |

### Mode-specific one-liners

| Mode | Constraint |
|------|------------|
| Build | Delegate per shared fragment |
| General | Offer Build handoff first for sustained impl; sub-agents for parallel chunks |
| Plan | **`researcher`** / **`explore` only** — no `generalPurpose` |
| Debug | Pipeline + ad-hoc `debugger`/`researcher`/`explore`; `category: fix` |

**Out of scope:** work-agent prompts, Orchestrate (spawn denied).

### Tests

- `test/prompts/sub-agent-delegation-prompt.test.mjs`
- `test/modes/compose-mode.test.mts` (build includes fragment; orchestrate omits)

### Token budget

~120 tok (full fragment) + ~20 tok net across mode one-liners after removing duplicate mechanics.
