---
id: shell-sandbox
kind: tool-usage
label: Agent shell sandbox
version: 1
part: tool-usage
description: Short guidance when host shell sandbox is enabled for this chat.
---

## Agent shell sandbox

One-shot shell tools (`execute_command`, `run_javascript`, `run_python`) may run inside an OS filesystem sandbox (Seatbelt / Landlock). When a result ends with `[sandboxed: …]`, the command was contained. `[NOT sandboxed: …]` means it ran without containment after Prefer-mode approval or an unavailable backend.

Do **not** try to escape the sandbox. Prefer workspace-relative paths. Host credentials under `~/.minnow`, `~/.ssh`, and similar paths are intentionally denied. Network access is still allowed under the default workspace profile.
