# UND_ERR_BODY_TIMEOUT — LM Studio chats stopping

## Symptoms

- Reply fails with `Could not complete this reply: UND_ERR_BODY_TIMEOUT`
- Often during slow models, long reasoning pauses, or heavy tool loops
- Partial turn output may disappear from the transcript (failed-turn rollback, MIN-184)

## Root cause

Node's built-in `fetch` (undici) enforces a **300 second (5 minute) body idle timeout** between response chunks. This fires **before** Minnow's configurable generation idle timeout (default **25 minutes** in Settings → Tools).

When LM Studio pauses longer than 5 minutes between SSE tokens (common with reasoning models, large context, or GPU contention), undici aborts the upstream connection with `UND_ERR_BODY_TIMEOUT`. The generation fails and the client surfaces the raw error code.

## Fix (shipped)

[`server/generations/upstream-fetch.js`](../../server/generations/upstream-fetch.js) uses a shared undici `Agent` with `bodyTimeout: 0` and `headersTimeout: 0`. [`server/generations/upstream.js`](../../server/generations/upstream.js) still enforces idle + max wall-clock limits via `AbortController` and `readGenerationUpstreamTimeouts()`.

Client copy for undici timeout codes is improved in `formatGenerationErrorMessage()` (`src/api/generations.ts`).

## History “loss”

Two separate behaviors:

1. **Failed-turn rollback (MIN-184)** — After a failed tool-loop turn, partial assistant/tool rows from *that turn only* are removed so the next send does not replay poisoned history. Earlier turns in the chat are kept.
2. **No assistant row on simple failure** — If generation fails before a complete reply is committed, only the user message remains in `chat.history` (the error bubble is DOM-only until retry).

## Manual verification

1. Restart Minnow (`npm start`) so the server picks up `upstream-fetch.js`.
2. Use a slow local model or a prompt that triggers long reasoning gaps (>5 min between tokens).
3. Confirm the stream continues past 5 minutes (until Minnow's idle/max limits or model completion).
4. If idle timeout is hit, expect the friendly message from `generationTimeoutMessage`, not `UND_ERR_BODY_TIMEOUT`.

## Related

- Generation timeouts: Settings → Tools → **Generation timeouts**
- [`documentation/plans/bug-investigations/MIN-184.md`](MIN-184.md) — poisoned tool-tail / rollback behavior
