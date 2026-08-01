# Skip per-task testing (board header)

## Summary

Board header toggle **Skip per-task tests** defers all per-task Tester work until the existing full-board final integration test. When enabled before **Start**, the kanban drops the Testing lane (unless a task is already in `testing` from a prior session), build passes merge straight to **Complete**, and card-level **Run tests** / manual Testing advances are hidden.

## Todos

- [x] Add `skipPerTaskTesting` to `OrchestrateBoardState` + `setBoardSkipPerTaskTesting` with pre-run lock rule
- [x] Extract `completeTaskAfterVerificationPass`; branch build-pass and env-fixer resume; resume sweep for build-pass + skip
- [x] Board header toggle, refresh sync, disabled when locked; CSS in `orchestrate-board.css`
- [x] Dynamic column defs + compact strip; hide Testing if skip and no task in `testing`
- [x] Board-log edge + task-testing/UI tests; update `context.md`

## Lock rule

Toggle enabled only while the board is pre-run: no `autoRunning`, and every task is `planned` or `blocked`. After **Start** or any execution status, the value is frozen (disabled control).

## Default

`skipPerTaskTesting: false` (omitted on legacy boards).

## Out of scope (v1)

Settings default, onboarding checkbox, per-card Run tests while skip is on, changing skip mid-board after Start.
