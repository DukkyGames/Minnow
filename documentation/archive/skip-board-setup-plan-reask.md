# Skip redundant board setup plan picker

## Problem

When a board opens from a selected plan or a Plan-mode handoff, setup already binds `chat.orchestratePlanPath` / `group.orchestratePlanPath`. Onboarding then auto-kickoffs `kickoffOrchestrateBoardBuild`. The model still called `ask_question` (“Which plan file should I parse for board_init?”) because:

1. Orchestrate mode body already says: if `{{orchestrate_plan}}` is set, read it and do not ask — but that body is omitted when the default Orchestrator work-agent is active (`shouldSuppressModePart`).
2. The Orchestrator work-agent prompt said “Read the user-specified plan or ask which plan…” and never mentioned `{{orchestrate_plan}}`.
3. Kickoff user text was pathless: “Parse the selected plan…”.

Same class of bug as MIN-615 (git re-ask via `ask_question`).

## Desired behavior

When a plan is already known: skip that question only and continue setup/`board_init` with the bound path. If no path is bound, asking remains OK.

## Fix (todos)

- [x] Orchestrator `agent.full.md` / `agent.lite.md`: if `{{orchestrate_plan}}` is set, `read_file` it and do not ask; bump versions
- [x] `buildBoardOnboardingKickoffMessage(planPath)` names the bound path; keep `BOARD_ONBOARDING_KICKOFF_MARKER` for duplicate-skip and init-split detection
- [x] `kickoffOrchestrateBoardBuild` resolves the effective path from chat/group and sends the built message
- [x] Prompt contract + kickoff unit tests; init-split still matches path-named kickoff
- [x] `documentation/context.md`

## Verification

- `node --test --import ./test/test-loader.mjs test/prompts/orchestrate-board-prompt.test.mjs`
- `node --test --import ./test/test-loader.mjs test/ui/orchestrate-board-kickoff.test.mjs`
- `node --test --import ./test/test-loader.mjs test/ui/orchestrate-board-init-split.test.mjs`
- `node --test --import ./test/test-loader.mjs test/modes/compose-mode.test.mts`
- `npx tsc --noEmit`
