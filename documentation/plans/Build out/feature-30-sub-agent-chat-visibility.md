---
name: Sub-agent chat visibility
overview: "Shipped implementation — live cards, transcript drawer, list/get parent tools, session snapshots, and orchestrate prompt updates."
todos:
  - id: done-events
    content: Event bus + orchestrator emit hooks
    status: completed
  - id: done-tools
    content: list_sub_agents + get_sub_agent_status tools and tests
    status: completed
  - id: done-persist
    content: chat.subAgentRuns + session sync on terminal runs
    status: completed
  - id: done-ui
    content: Cards, drawer, CSS, loop anchor data-tool-call-id
    status: completed
  - id: done-docs
    content: context.md + mode/work-agent prompts
    status: completed
isProject: false
---

# Feature 30 — Sub-agent chat visibility (shipped)

## Summary

- **Live cards** in the parent chat (`src/ui/sub-agent-cards.ts`) subscribe to `src/agents/sub-agent-events.ts` and update on each orchestrator notification (including nested tool progress via `liveNestedToolCalls`).
- **Transcript drawer** (`src/ui/sub-agent-drawer.ts`, `src/styles/sub-agent-drawer.css`) opens on card click; **Cancel** when the run is still `queued` / `running`. `dismissOpenLayers` closes the drawer.
- **Parent tools** `list_sub_agents` and `get_sub_agent_status` in `src/tools/definitions.ts`, executed in `src/tools/sub-agent-executor.ts`, denied inside child agents via `src/agents/sub-agent-tools.ts`.
- **Persistence:** terminal runs saved to `chat.subAgentRuns` (`PersistedSubAgentRun` in `src/types.ts`) by `src/state/sub-agent-session-sync.ts`; `src/state/sessions.ts` hydrates on load; `renderChatFromHistory` remounts cards.
- **Anchoring:** `src/tools/loop.ts` sets `data-tool-call-id` on each tool row and refreshes `setSubAgentExecutorContext` per tool with `parentToolCallId`; `SubAgentRun.parentToolCallId` links cards after the spawn tool bubble.

## Verification

1. Enable sub-agents; send a message that triggers `spawn_sub_agent` (orchestrate + orchestrator work agent).
2. Confirm a **Working** card appears while the sub-agent runs; click → drawer shows transcript.
3. After completion, reload the page — card/drawer still load from persisted `subAgentRuns`.
4. In the same parent turn, call `list_sub_agents` then `get_sub_agent_status` from the model and confirm JSON.

## Follow-ups (not in this feature)

- Parallel execution of multiple tool calls in one assistant turn (true overlap in one HTTP round).
- Mid-run persistence of partial transcripts for reload-during-run.
