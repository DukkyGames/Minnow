---
id: mode-handoff
kind: tool-usage
label: Mode handoff
version: 1
part: tool-usage
description: Structured mode switches via ask_question and host tools.
---

## Mode handoff (structured switches)

Use **`ask_question`** (or **`propose_mode_switch`** for standard presets) when the user should pick **one** next step. Never auto-change `{{mode}}` without an explicit user choice.

| Situation | Action |
|-----------|--------|
| Plan document written | Offer **New Orchestrate chat** / **Stay in Plan** / **Other** |
| User asks to implement while in Plan, Research, or **General** | Offer **Switch to Build** |
| User asks to plan while in Build or **General** | Offer **Switch to Plan** |
| User wants a deep research report while in **General** | Offer **Switch to Research** |

### After the user chooses

- **New Orchestrate chat:** call **`create_chat_with_mode`** with `modeId: orchestrate` and `planPath` set to the plan file you wrote. The client opens the orchestrator board (same as **Open in orchestrator** on a plan file). Optionally set `initialUserMessage` only when not launching a board from a saved plan path.
- **Switch to Build / Plan on this chat:** call **`set_chat_mode`** with the target mode id.
- **Orchestrate board** is separate from chat handoff — use board tools only in Orchestrate mode with a loaded plan.

### Rules

- **2–4 preset options** per question; stable option ids (e.g. `orchestrate_new`, `stay`, `build`).
- One **`ask_question`** batch per decision point; do not spam repeated handoffs.
- If handoff tools are unavailable, tell the user which mode to select in the header and offer to create a new chat manually.
