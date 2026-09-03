# Browser Evaluate can stall orchestrator tasks

## Status

Done — `browser_eval` / preview `execJs` are bounded at 30s (guest wrapper + main process + renderer abort race).

## Todos

- [x] Diagnose: `previewExecJs` awaits `executeJavaScript` with no deadline; wrapper `await`s thenables
- [x] Bound guest wrapper + main-process `previewExecJs` (same pattern as screenshot `capturePage`)
- [x] Race renderer `execJs` with timeout + chat abort so Stop / stall recovery can unblock
- [x] Tests: never-settling Promise, hung `executeJavaScript`, renderer abort
- [x] Update `documentation/context.md` and the `browser_eval` tool description

## Symptom

Orchestrate task chats (and any other tool loop) can sit on **Evaluate** forever. Board stall recovery calls `stopGeneration`, but the in-flight `browser_eval` ignores abort, so the task never frees the slot.

## Why it hangs

`browser_eval` → `window.minnow.preview.execJs` → Electron `previewExecJs` → `webContents.executeJavaScript`.

The guest wrapper is:

```js
const __v = await (0, eval)(userCode);
```

That never settles when the page script:

1. Returns a Promise that never resolves (`new Promise(() => {})`, `fetch` to a dead host, a `MutationObserver` that never fires)
2. Runs an infinite loop (`while (true) {}`) — blocks the guest event loop so even a guest-side timer cannot fire
3. Is queued behind a previous hung `executeJavaScript` on the same `WebContents`

Screenshot already races `capturePage` at 3s (`PREVIEW_CAPTURE_PAGE_TIMEOUT_MS`). Eval has no equivalent.

Board task-chat supervision only `bumpProgress`es on **stream** activity, not tool execution. Default stall is `3 × progressStallMs` (≈4.5 min) and `stopGeneration` cannot abort the hung IPC, so the board stays wedged.

## Approach

1. **Guest wrapper** — `Promise.race` eval against a timer so never-settling Promises complete `executeJavaScript` and free the guest queue.
2. **Main process** — `withTimeout` around `executeJavaScript` so an infinite loop / wedged renderer cannot pin IPC forever. Returns `{ __execError }` (does not cancel the underlying script).
3. **Renderer** — race `execJs` with the same deadline **and** the chat `AbortSignal`, so Stop and stall recovery do not wait out the full timeout. Covers a stale `electron/dist` that lacks the main-process bound.

Timeout: **30s**, matching the default shell command budget and Playwright `page.evaluate`. Far below the ~4.5 min board stall window.

Out of scope for this pass: CDP `Runtime.terminateExecution` / reload-on-timeout to unstick an infinite loop in the guest. The tool loop continues; a later `browser_navigate` or Reload clears a wedged page.

## Assumptions

- 30s is enough for real DOM queries and short waits; agents should not sleep forever inside `browser_eval`.
- Snapshot / click / fill share `execJs`, so they get the same bound (they only hang when the guest is already wedged).
