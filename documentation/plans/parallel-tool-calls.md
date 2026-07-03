# Parallel Tool Calls

## Goal

When the model emits multiple `tool_calls` in one assistant message, **read-only / cacheable** tools run concurrently (bounded pool). **Mutating, interactive, and stateful** tools stay sequential. Behavior is **always on** (no Settings toggle).

## Architecture

```
tool_calls (original order)
  → partitionToolCalls (left-to-right segments)
  → parallel segment: runWithConcurrency (cap 6)
  → sequential segment: for-await executeTool
  → ToolCallOutcome[] in original order
```

Example: `[grep, read_file, save_file, git_status]` → parallel `[grep, read_file]` → sequential `save_file` → parallel `[git_status]`.

## Modules

| Module | Role |
|--------|------|
| [`src/tools/parallel-tool-policy.ts`](../src/tools/parallel-tool-policy.ts) | `isParallelSafeTool`, `partitionToolCalls`, `MAX_PARALLEL_READ_TOOLS` |
| [`src/tools/tool-cache-policy.ts`](../src/tools/tool-cache-policy.ts) | Static cacheable tool policy (shared with result-cache) |
| [`src/tools/execute-tool-batch.ts`](../src/tools/execute-tool-batch.ts) | Bounded batch executor + abort handling |
| [`src/lib/concurrency-pool.ts`](../src/lib/concurrency-pool.ts) | `runWithConcurrency` worker pool |
| [`src/tools/chat-tool-batch.ts`](../src/tools/chat-tool-batch.ts) | Main chat + resume DOM/history wiring |
| [`src/tools/headless-tool-batch.ts`](../src/tools/headless-tool-batch.ts) | Sub-agent / headless / eval / benchmark adapter |

## Wired runtimes

- Main chat: [`src/tools/loop.ts`](../src/tools/loop.ts)
- Incomplete resume: [`src/chat/incomplete-tool-resume.ts`](../src/chat/incomplete-tool-resume.ts)
- Sub-agents: [`src/agents/sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts)
- Headless CLI: [`src/headless/runner.ts`](../src/headless/runner.ts)
- Evals: [`src/evals/runner.ts`](../src/evals/runner.ts)
- Benchmarks: [`src/benchmark/llm-driver.ts`](../src/benchmark/llm-driver.ts)

## Tests

```bash
node --import ./test/test-loader.mjs --experimental-test-module-mocks ./node_modules/tsx/dist/cli.mjs --test test/tools/parallel-tool-policy.test.mts test/tools/execute-tool-batch.test.mts
```

## Out of scope

- Parallel mutating tools (writes, git, shell)
- User-facing concurrency setting
- Parallelism across assistant turns
