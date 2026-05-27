# BUG-022 — Sub-agent "Invalid JSON in final response"

## Todos

- [x] Tool-use nudge when tools enabled but no tool round yet (`SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION`)
- [x] Merge `{"tool_calls":[...]}` from assistant content when SSE deltas are empty (`constrained-tool-content.ts` + main `loop.ts`)
- [x] Clearer final-turn errors (empty vs invalid JSON + preview)
- [x] Optional `response_format` on final turn when provider structured-output probe allows (`sub-agent-outcome-response-format.ts`, `isStructuredOutcomeResponseFormatAvailable`)
- [x] Preflight: fail when resolved model id is empty (default runner only, so unit mocks still run)
- [x] Dev logging: `localStorage.minnowDebugSubAgent = '1'`

## Summary

Spawns could fail immediately with `Invalid JSON in final response` and `toolTurns: 0` when the work model never issued OpenAI-style `delta.tool_calls`, skipped tools in prose, or returned an empty final completion after a forced JSON handoff (MIN-43).

## Resolution (2026-05-27)

| Area | Change |
|------|--------|
| Runner | Tool branch when `toolCalls.length > 0` (not only `finish_reason === 'tool_calls'`); tool nudge user message before finalization |
| Provider parity | `mergeContentJsonToolCalls` / `tryParseToolCallsFromAssistantContent` |
| Final turn | Distinct empty error; previews on parse/schema failure; optional `response_format` + strip retry |
| Orchestrator | Empty `modelId` + default runner → fail fast with actionable message |
| Probe | `isStructuredOutcomeResponseFormatAvailable` in `capability-probe.ts` |

## Verification

- `npx tsx --import ./test/test-loader.mjs --test test/providers/constrained-tool-content.test.mts test/sub-agents/sub-agent-preflight-model.test.mts test/sub-agents/sub-agent-outcome-response-format.test.mts`
- Manual: spawn `shell` sub-agent to create a small file; confirm `toolTurns >= 1` or drawer shows nudge + second work turn.
