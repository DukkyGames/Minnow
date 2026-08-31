# Orchestrator V2 agent prompts (P2-E / P3-F)

Builder, Tester, and Final Tester system prompts for the headless runner. They live here, not
under `src/chat/prompts/work-agents/`, so:

- V1's `builder` / `tester` work-agent prompts stay as general work agents.
  V2 boards use these files; `report_outcome` is the attempt report tool.
- `server/runner/` never imports them. The runner does not know what a task is;
  P2-F loads a prompt and passes it as `runTurn({ systemPrompt })` along with
  `reportToolFor(role)` and `parseReportFor(role)`. **Phase 6 finding:**
  `systemPrompt` was added to `runTurn` so this injection does not bake a role
  into the runner.

Seeds (the user message) are `server/orchestrator/seeds.js` for Builder/Tester.
The Final Tester ladder itself is mechanical (`final-test.js`); `prompts/final/`
tells the agent to run those fixed commands via `execute_command`. Tests may
drive the ladder with no model.

Neither Builder nor Tester prompt mentions boards, waves, delegation, or
lifecycle reporting. `blocked` is defined in the Builder prompt as *the
environment cannot support the work*. The Final Tester must not reopen tasks.
