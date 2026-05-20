# Step 10 verification — Bottom terminal panel

## Automated

```powershell
cd c:\Users\dukky\Documents\Development\Minnow
npm test
npm run build
```

With dev server running (`npm start` in another terminal):

```powershell
node test/terminal-stream.test.mjs http://localhost:5173
```

| Test | Expected |
|------|----------|
| `run_returns_runId` | HTTP 200, `runId` matches UUID regex |
| `stream_emits_stdout_and_exit` | SSE events include `stdout` with `MINNOW_STREAM_OK` and `exit` with `code: 0` |
| `unknown_run_404` | HTTP 404 for unknown `runId` |
| `invalid_command_400` | HTTP 400 when `command` missing |
| `history_scoped_to_chat` | `GET /api/terminal/history?chatId=A` lists only chat A runs |

Fixed chat ids in tests: `11111111-1111-1111-1111-111111111111`, `22222222-2222-2222-2222-222222222222`.

Regression:

```powershell
node scripts/sa16-smoke.mjs http://localhost:5173
```

## Manual

1. `npm start` → click **Terminal** in top bar (or `Ctrl+``) → run `echo hello` → streaming output appears.
2. Enable `execute_command` → ask model to run `node -e "console.log(1)"` → panel streams during tool turn; tool bubble shows final result.
3. Switch chat → history sidebar shows only that chat's runs.
4. Reload page → history restores from `~/.minnow/sessions/state.json`.
5. Collapse terminal → chat area expands; reopen persists via `config.json` `terminal.open`.
6. `npm run dev` (no API) → offline banner; user **Run** disabled.
7. Command exceeding 30s → `timedOut: true` in exit event and tool result mentions timeout.

## PASS criteria

- [ ] Bottom docked terminal panel (collapsible, resizable)
- [ ] SSE live stdout/stderr for server runs
- [ ] AI `execute_command` / code tools stream in panel
- [ ] Per-chat `terminalHistory` + `~/.minnow/logs/terminal/<runId>.log`
- [ ] `test/terminal-stream.test.mjs` passes against `npm start`
- [ ] `documentation/context.md` updated
- [ ] `POST /api/tools` `execute_command` still works (sa16 smoke)
