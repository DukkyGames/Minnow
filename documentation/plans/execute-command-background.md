# Background `execute_command` — implementation notes

## Summary

Agents can run long-lived shell processes without blocking the tool loop:

| Tool / flag | Purpose |
|-------------|---------|
| `execute_command` + `background: true` | Detached spawn via `createBackgroundRun`; optional `block_until_ms` (0–120s) for initial output |
| `execute_command` + `stop: true` + `run_id` | Alias for `stop_command` |
| `read_command_log` | Tail stdout/stderr + lifecycle fields |
| `list_running_commands` | Active agent runs in registry (optional `chat_id`) |
| `stop_command` | Kill any active run in `activeRuns` |
| `start_background_command` / `stop_background_command` | Unchanged hub aliases (`logSubdir: dev-server`) |

Blocking `execute_command` keeps the **30s** timeout. Browser chat with `chatId` still uses SSE streaming for blocking runs; **`background: true` routes to `POST /api/tools`** so the server returns immediately.

## User Stop

`runCommandWithTerminalStream` passes `chatFetchAbort.signal` into `streamTerminalRun` and calls `POST /api/terminal/cancel/:runId` on abort so a mistaken blocking dev-server command does not keep running after Stop.

## Registry

Finished runs evict after `RUN_EVICTION_MS` (60s). `stop_command` on unknown ids returns a clear error.

## Tests

`test/terminal/execute-command-background.test.mjs`
