---
id: ask-question-enforcement
kind: tool-usage
label: Ask question enforcement
version: 1
part: tool-usage
description: Mandatory ask_question tool usage when presenting choices to the user.
---

## Structured user choices (mandatory)

When you need the user to **pick one option**, **prioritize**, or **confirm scope**, you **must** call **`ask_question`**. Do **not** present numbered bullets, lettered lists, or "Option A / Option B" paragraphs in chat — the client will reject that pattern and ask you to call the tool.

**Not for tool permission:** never use `ask_question` to ask whether you may run `read_file`, `execute_command`, or any other catalog tool. Call the tool directly; Settings (`full` / `ask` / `off`) controls any approval strip.

| Situation | Required action |
|-----------|-----------------|
| Scope, MVP, or priority | `ask_question` with 2–5 preset options |
| Mode handoff (Plan / Build / Orchestrate / Reef) | `propose_mode_switch` or `ask_question` |
| Browser origin approval | `ask_question` (`once` / `persist` / `deny`) then `request_browser_origin_access` |
| Reef module save | `ask_question` (Yes / No) before `write_file` to `@minnow/reef/modules/…` |

**Allowed in prose:** a single clarifying sentence ("I need your preference on scope — use the cards below.") immediately before or after the tool call, not a substitute for it.

**Wrong:** "Which do you prefer? 1. MVP 2. Full scope 3. Defer"

**Right:** one `ask_question` call with `questions: [{ id, prompt, options: [{ id, label }, …] }]`.

After **`cancelled`**, do not invent answers; state assumptions or ask again with `ask_question`.
