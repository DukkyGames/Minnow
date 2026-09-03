---
name: board-plan-repair
overview: When parsePlan refuses a plan on Boards, a Repair button runs a dedicated background plan-repairer sub-agent that rewrites the same file for schema only, then Open board is retried.
todos:
  - id: plan-repairer-type
    content: Add plan-repairer type (sub-agents.json, full/lite prompts, shipped prompt map) with schema-only unattended contract and save_file + read tools
    status: completed
  - id: repair-runner
    content: "Implement src/orchestrator/plan-repair.ts: background chat, spawn, wait, retry createBoard, cancel, no activeId steal"
    status: completed
  - id: boards-ui
    content: Add Repair/Cancel/status to parse-error pane on ask pane and create form; auto-select board after successful retry
    status: completed
  - id: tests
    content: Cover UI, runner (spawn + retry + activeId), config/tools allowlist, and prompt smoke checks
    status: completed
  - id: docs
    content: Write documentation/plans/board-plan-repair.md; update context.md, settings-reference types, and boards.md Starting a board
    status: completed
isProject: false
---

# Repair unparseable board plans

## Agreed context

- **Goal:** Stop sending the user back to Plan / Super Plan chat to fix schema so `parsePlan` can accept the file.
- **After success:** Automatically retry **Open board** / **Create** (creates the board; does not Start agents).
- **Rewrite scope:** Schema and structure only — same waves, task ids, and intent; fill missing fields, fix headings, `todos`, Touches, Depends on.
- **File:** Overwrite the selected plan in place. No sidecar copy.

This is the user-triggered form of Orchestrator V2 PRD §5.9.4 (one-time LLM conversion at intake). The control plane stays LLM-free: `POST /api/boards` still only calls [`parsePlan`](../../server/orchestrator/core/parse-plan.js).

## Flow

1. **Open board** / **Create** calls `POST /api/boards` → `parsePlan`.
2. On `PlanParseFailure`, the parse pane lists line/column/message/hint and a **Repair** button.
3. Repair spawns `plan-repairer` in a background Plan chat (`plan-repair:<workspace>:<path>`). It never assigns `sessionState.activeId` (MIN-637).
4. The agent overwrites the same file (schema only). Boards waits, then retries `createBoard`.
5. Success selects the new board. A still-broken file re-renders the error list. Repair does not auto-spawn again.

## Implementation

| Piece | Location |
|-------|----------|
| Sub-agent type | [`src/agents/defaults/sub-agents.json`](../../src/agents/defaults/sub-agents.json) `plan-repairer` |
| Prompts | [`src/agents/prompts/sub-agents/plan-repairer.full.md`](../../src/agents/prompts/sub-agents/plan-repairer.full.md) + `.lite.md`, [`shipped-sub-agent-prompts.ts`](../../src/agents/shipped-sub-agent-prompts.ts) |
| Runner | [`src/orchestrator/plan-repair.ts`](../../src/orchestrator/plan-repair.ts) |
| UI | [`src/orchestrator/boards-view.ts`](../../src/orchestrator/boards-view.ts) `renderCreateError` |

## Non-goals

- Save-time `parsePlan` rejection inside `save_file` (PRD open question 4)
- Auto-repair without a click, or an auto-retry loop of the agent
- Opening or focusing the background chat
- Starting the board after create
- Softening `parsePlan` itself
