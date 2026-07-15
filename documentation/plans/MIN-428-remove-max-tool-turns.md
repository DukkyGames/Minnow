# MIN-428: Remove max tool turns

## Product decision

Remove the hard cap on agent tool loops. Main composer, sub-agents, headless CLI, and eval runners continue until:

- The model returns a final assistant answer (no further tool calls), or
- The user cancels the turn/run, or
- A safety guard fires (generation idle/max duration, context budget, watchdog, board quarantine).

The previous `chat.maxToolTurns` / `sub-agents.json` `maxToolTurns` settings and UI are removed. Legacy keys are stripped on config load.

## Todos

- [x] Remove cap from `src/tools/loop.ts` main tool loop
- [x] Remove cap from `src/agents/sub-agent-runner.ts`
- [x] Remove Settings UI and registry entries for tool turn limits
- [x] Remove `chat.maxToolTurns` from `ChatMeta` and server validators
- [x] Update headless CLI (drop `--max-tool-turns`)
- [x] Update tests and `documentation/context.md`

## Safety guards retained

- User Stop / `AbortSignal`
- `chat.generationIdleTimeoutMs` and `chat.generationMaxDurationMs`
- Sub-agent context budget (`context_budget`)
- Orchestrate watchdog, self-heal, and board quarantine
- Legacy `max_tool_turns` terminal reason detection for older persisted runs
