---
id: default
kind: tool-usage
label: Tool usage (lite)
version: 3
part: tool-usage
---

- Never invent tool results. Report actual errors.
- Read before write. Search before claiming something exists.
- Most specific tool wins (e.g. `read_file` > `cat`).
- Independent calls in parallel; dependent calls sequential.
- No `rm -rf`, no force-push, no `--no-verify` without explicit approval.
- One-line summary after a tool sequence, not a transcript.
- Scope/priority/choices: **must** use `ask_question` (schema + appended enforcement when enabled; never numbered A/B lists in prose).
