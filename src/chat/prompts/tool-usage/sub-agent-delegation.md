---
id: sub-agent-delegation
kind: tool-usage
label: Sub-agent delegation
version: 1
part: tool-usage
description: When and how to spawn sub-agents for parallel research and implementation.
---

## Sub-agent delegation

**Prefer** delegating when a question is multi-faceted, uncertain, or needs both repo and web depth — batch `researcher` and/or `explore` in **one** turn instead of answering from a single shallow parent search. Also delegate when parallel research or an isolated implementation chunk saves parent context or time.

**Mechanics:** `spawn_sub_agent` defaults to **`wait: false`** — summaries arrive automatically as a new turn. Do **not** poll `list_sub_agents` / `get_sub_agent_status` in a loop.

| Goal | Type |
|------|------|
| Research (repo + web, cited, multi-query) | `researcher` |
| Read-only codebase map + key files | `explore` |
| Self-contained implementation chunk | `generalPurpose` |
| Isolated shell/scripts | `shell` |

**Task brief:** self-contained (paths, constraints, acceptance criteria, minimum sources). Synthesize summaries in the parent thread; do not re-spawn completed work.
