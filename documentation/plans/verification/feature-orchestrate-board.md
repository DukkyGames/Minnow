# Orchestrate Board View — verification checklist

## Prerequisites

- `npm start` (local tool server)
- Orchestrate mode with a plan under `documentation/plans/`

## Automated tests

- `test/state/orchestrate-board-shape.test.mts`
- `test/orchestrate/board-store.test.mts`
- `test/tools/board-tools.test.mts`
- `test/orchestrate/orchestrator-board-link.test.mts`
- `test/ui/view-mode-toggle.test.mjs`
- `test/ui/orchestrate-board-streaming.test.mjs`
- `test/prompts/orchestrate-board-prompt.test.mjs`
- `test/orchestrate/orchestrate-send-gate.test.mts` (wired in `npm test`)

## Manual E2E

1. [ ] Chat/Board toggle appears when a plan is selected; Board replaces `#chatArea`.
2. [ ] Orchestrator calls `board_init` → tasks and waves appear; columns update on `board_update_task`.
3. [ ] Sub-agent grid shows category styling; per-card stop works.
4. [ ] Stop orchestrator aborts turn and child runs.
5. [ ] Board **Resume** (and Chat-view composer send) enqueue turns; composer hidden in board view; model continues from `board_get_state`.
6. [ ] Toggle Chat → full history unchanged; toggle Board → board restored from session.
7. [ ] Switch sidebar chat → correct board per chat.
8. [ ] Reload mid-run → board state persists; live agents may be empty until new spawns.
