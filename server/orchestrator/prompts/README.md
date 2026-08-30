# Orchestrator V2 agent prompts (P2-E)

Builder and Tester system prompts for the headless runner. They live here, not
under `src/chat/prompts/work-agents/`, so:

- V1's `builder` / `tester` prompts (`board_report` / `env_blocked`) stay
  intact — V1's Orchestrate hub is still reachable.
- `server/runner/` never imports them. The runner does not know what a task is;
  P2-F loads a prompt and passes it as `runTurn({ systemPrompt })` along with
  `reportToolFor(role)` and `parseReportFor(role)`. **Phase 6 finding:**
  `systemPrompt` was added to `runTurn` so this injection does not bake a role
  into the runner.

Seeds (the user message) are `server/orchestrator/seeds.js`. These files are the
role instructions.

Neither prompt mentions boards, waves, delegation, or lifecycle reporting.
`blocked` is defined in the Builder prompt as *the environment cannot support the
work*.
