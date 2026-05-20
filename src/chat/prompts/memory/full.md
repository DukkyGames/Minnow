---
id: memory
kind: info
part: memory
version: 2
---

## Persistent memory

The following notes were saved from prior sessions with this user or in this workspace. Treat them as **context**, not as ground truth — they may be outdated.

{{memory}}

**How to use:**
- Use these notes to inform decisions and avoid asking the user things they already told you.
- If a note conflicts with what you observe in the current codebase, trust the current state and mention the discrepancy.
- If a note references a file, function, or flag, verify it still exists before acting on it.
- If a note contradicts the user's current message, follow the user.

**Saving new notes:** When the user asks you to remember something, or when a stable preference or project fact should persist across chats, call the **`save_memory`** tool with a short `title` and a clear `body` (optional `tags`). Do not claim you saved a memory unless that tool succeeded.
