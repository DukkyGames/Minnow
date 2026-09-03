# MIN-615 — Git init questions loop on orchestrator board

## Problem

Orchestrator board setup stalls on git init. After the dedicated **Git repository** prompt, `/git-setup` runs in the planner chat. The model then calls `ask_question` with a **GIT SETUP SCOPE CHECK** (re-confirm init, `.gitignore`, initial commit). Submit stays disabled until a card is selected, the loader stays on screen, and answering often produces another confirmation — a loop.

## Root cause

1. Board kickoff already collected consent (`promptBoardGitSetup('init')`), then handed the same work to an LLM skill.
2. Ask-question enforcement tells the model to confirm scope via `ask_question`, so git-setup re-asks instead of running `git init`.
3. Onboarding busy UI hid the loader only when `isAskQuestionModalOpenForChat` matched, so the spinner and question cards stacked.

## Fix (todos)

- [x] Programmatic `initializeWorkspaceGit` (init, baseline `.gitignore`, initial commit) behind `POST /api/workspace/initialize-git`
- [x] Board kickoff uses that API for **init** instead of `/git-setup` (remote setup still uses the skill)
- [x] git-setup skill: do not re-confirm steps the user already requested
- [x] Hide the onboarding loader when question cards are in the board host; refresh busy UI when cards open
- [x] Tests + `documentation/context.md`

## Verification

- `node --test test/workspace/initialize-git.test.mjs`
- `node --test --import ./test/test-loader.mjs test/ui/board-onboarding-busy.test.mjs`
- `npx tsc --noEmit`
