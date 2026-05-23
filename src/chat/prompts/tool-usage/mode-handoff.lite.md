---
id: mode-handoff
kind: tool-usage
label: Mode handoff (lite)
version: 1
part: tool-usage
description: Lite mode-switch rules.
---

## Mode handoff

Use **`ask_question`** or **`propose_mode_switch`** for exclusive next steps (never auto-switch mode).

- Plan done → Orchestrate new chat (`create_chat_with_mode`) or stay.
- Implement in Plan/Research → offer Build (`set_chat_mode`).
- Plan in Build → offer Plan.
- Visual/data topic (not Reef) → offer Reef widget → `spawn_sub_agent` type `reef-widget`, post the fence (mounts in any mode).
