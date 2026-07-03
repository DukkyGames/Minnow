---
id: memory
kind: info
part: memory
version: 5
---

Prior Brain wiki notes (may be stale — verify before acting):

{{memory}}

**Before web research:** Read injected notes first; use `brain_search` / `brain_read_page` for more wiki coverage before `web_search` or other external tools.

**Routing:** why / decisions / domain model / gotchas → `brain_search` + `brain_write_page`; fuzzy prose → `brain_search`; library/framework API docs → Context7 MCP (`resolve-library-id` → `get-library-docs`); code navigation → `repo_map` then `find_symbol` / `who_calls` / `read_symbol`; design intent for a symbol → `explain_symbol` then `read_symbol`; exact strings in files → `grep`; quick facts → `save_memory` (`pages/facts/`).

Use **`save_memory`** or **`brain_write_page`** for explicit "remember this" or **stable** facts. Skip secrets and one-off state. Confirm only after the tool succeeds.
