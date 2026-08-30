# `server/runner` — shared headless turn loop

Extract of `src/agents/sub-agent-runner.ts` (MIN-698 / P2-A). Plain `.js` + `.d.ts`
so the Node server can import it without a transpile step.

The package does not know what a board is. Completions, tools, and transcripts
are injected (`RunnerDeps`). P2-C binds completions in-process. P2-D binds
tools in-process (`createInProcessToolDispatch`). P2-E supplies
Builder/Tester report schemas. P2-F maps turn results onto the engine.

## `runTurn()` — Phase 6 contract (MIN-699 / P2-B)

```ts
runTurn({ chatId, seed, tools, model, onEvent }) -> TurnResult
```

**Any change to this signature is a Phase 6 finding and must be recorded as one.**
Phase 6 is "all chat eventually" (locked decision 5). If this entry point learns
what a board is, that phase becomes a rewrite.

`chatId` is an opaque string. The runner never parses it, never looks it up, and
does not require a board (or any other product object) to exist.

### Result shape

The return value is the six-way **object** union from PRD §5.3. It is named
`TurnResult` in this package because `server/orchestrator/core` already uses
`AttemptResult` for the **string** alias (`'pass' | 'fail' | …`). Do not smash
those types together. P2-F maps `result.outcome` onto the core string.

```ts
type TurnResult =
  | { outcome: 'pass';    summary: string; evidence: string[] }
  | { outcome: 'fail';    summary: string; blockers: string[] }
  | { outcome: 'blocked'; summary: string; needs: string[] }
  | { outcome: 'no_report' }
  | { outcome: 'crashed'; error: string }
  | { outcome: 'timeout' }
```

- `pass` / `fail` / `blocked` — only from a successful call to the injected
  report tool (`reportToolName`, default `report_outcome`). Returned verbatim.
- `no_report` — the loop ended without a successful report-tool invocation.
  Assistant prose is never parsed to invent an outcome. A *rejected* report
  (malformed payload) is not this: the tool was called, the model can retry.
- `crashed` — unrecoverable error (provider throw, HTTP failure, …) with message.
- `timeout` — `limits.wallClockMs` elapsed **or** `limits.maxTurns` was hit.

Malformed report-tool calls are rejected **at execute-time** (P2-E): the tool
result is an error the model can act on, the loop continues, and a later valid
call still produces `pass` / `fail` / `blocked`. Inject `parseReport` for a
role-specific schema; the default parser stays the PRD union and does not know
Builder vs Tester. **Phase 6 finding:** `parseReport` was added to the options
object so a caller can reject without teaching this package a role name.

### Parameters

| Name | Role |
|------|------|
| `chatId` | Opaque correlation id. Transcript key only. |
| `seed` | Opening user message. |
| `tools` | Resolved OpenAI function-tool list. Capabilities are present or absent here — never hardcoded. |
| `model` | `providerId` + `id` + optional sampler / thinking. |
| `onEvent` | Presentation-free typed events (`delta`, `thinking`, `tool_call`, `tool_result`). The caller chooses DOM, SSE, or nothing. |
| `cwd` | Forwarded to tool execute context. This wrapper does not `chdir`. |
| `transcript` | P2-A `TranscriptStore`. Falls back to `deps.transcriptStore`. |
| `signal` | Caller abort. Distinct from wall-clock timeout. |
| `limits` | `maxTurns`, `wallClockMs`, context budget, model context limit. |
| `deps` | P2-A `RunnerDeps` — completions and tool dispatch stay injected. |
| `reportToolName` | Injected report tool (default `report_outcome`). Not a role name. |
| `parseReport` | Optional. How to accept a report payload. Default: PRD union. A `{ ok: false, error }` result is a tool error, not `no_report`. Phase 6 finding. |

`ask_question` is callable when it is in `tools` and unavailable when it is not.
There is no product-shaped branch for it in `run-turn.js`.

## Completions — in-process binding (MIN-700 / P2-C)

Server callers inject `postChatCompletionsInProcess` from [`node.js`](./node.js)
(not the isomorphic `index.js` barrel). It creates a generation (`persist: false`),
calls `pumpUpstream` in-process, and
returns a synthetic `Response` whose body replays SSE bytes — the same shape
`sse-parse.js` already consumes. There is no hop through `/api/generations`.

Default fallback role is `sub-agent` (agent family, not `utility` /
`chat-titles` / `goal-eval` / `editor-completion`). The loop may pass a more
specific type (`turn`, `explore`, …); those stay as-is. Aborting the `signal`
calls `cancel(state)` so the upstream request stops.

The renderer adapter (`src/agents/sub-agent-runner.ts`) keeps HTTP
`/api/generations` via `src/providers/fetch-chat.ts`. `postChatCompletionsHttp`
remains for tests that POST a fake host without the generations store.

## Tools — in-process dispatch (MIN-701 / P2-D)

Server callers inject `createInProcessToolDispatch({ cwd, allowedToolNames, modeId })`.
It closes over **required** `cwd` (never defaults to the Code workspace root),
applies the same HTTP-layer guards as POST `/api/tools`, then calls
`executeServerTool`. There is no hop through `/api/tools`.

`runTurn` already takes `execute` + `deps.runHeadlessToolBatch`. Wire both from
the same dispatch object:

```js
const dispatch = createInProcessToolDispatch({ cwd, allowedToolNames });
await runTurn({
  chatId, seed, tools, model, cwd,
  execute: dispatch.execute,
  deps: { ...deps, runHeadlessToolBatch: dispatch.runHeadlessToolBatch },
});
```

Batching is a port of `src/tools/execute-tool-batch.ts` (`MAX_PARALLEL_READ_TOOLS = 6`).
Do not invent new concurrency rules.

The renderer adapter must **not** import `tool-dispatch.js` or `node.js`
(it would pull `server/runtime/tools-middleware.js` into Vite). It keeps
`src/tools/headless-tool-batch.ts`. Vite follows unused named re-exports, so
in-process adapters are on [`node.js`](./node.js), not the isomorphic `index.js`.

Default unattended tool ids: `DEFAULT_HEADLESS_TOOL_IDS`. Renderer-only tools
are enumerated in [`tool-set.md`](./tool-set.md) (port vs exclude). The default
set contains none of them. The runner still does not know what a board is —
the list is an argument.
