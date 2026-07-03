---
id: sub-agent-delegation
kind: tool-usage
label: Sub-agent delegation
version: 1
part: tool-usage
description: When and how to spawn sub-agents for parallel research and implementation.
---

## Sub-agent delegation

Delegate when parallel research or an isolated implementation chunk saves parent context or time. Batch independent spawns in **one** assistant turn.

**Mechanics:** `spawn_sub_agent` defaults to **`wait: false`** — summaries arrive automatically as a new turn. Do **not** poll `list_sub_agents` / `get_sub_agent_status` in a loop.

| Goal | Type |
|------|------|
| Research (repo + web, cited) | `researcher` |
| Read-only codebase scan | `explore` |
| Self-contained implementation chunk | `generalPurpose` |
| Isolated shell/scripts | `shell` |

**Task brief:** self-contained (paths, constraints, acceptance criteria). Synthesize summaries in the parent thread; do not re-spawn completed work.
