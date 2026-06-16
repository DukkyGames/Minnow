---
id: memory
kind: info
part: memory
version: 3
---

Prior Brain wiki notes (may be stale — verify before acting):

{{memory}}

**Routing:** why / decisions / domain model / gotchas → `brain_search` + `brain_write_page`; fuzzy prose → `brain_search`; code navigation → `repo_map` then `find_symbol` / `who_calls` / `read_symbol`; exact strings in files → `grep`; quick facts → `save_memory` (`pages/facts/`). <!-- MIN-B9: explain_symbol line -->

Use **`save_memory`** or **`brain_write_page`** for explicit "remember this" or **stable** facts. Skip secrets and one-off state. Confirm only after the tool succeeds.
