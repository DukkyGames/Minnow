# BUG-016 — Stream JSON parse on close

## Todos

- [x] Root-cause: `tryNonStreamingFallback` called `Response.json()` on generations SSE shim
- [x] Add `src/api/sse-parse.ts` (event boundaries, glued JSON, `parseCompletionResponseBody`)
- [x] Wire chat / loop / sub-agent / benchmark / reef readers to `feedSseEventBuffer`
- [x] Prefix `\n\n` before server `event: end` sentinel
- [x] Tests: `test/api/sse-parse.test.mjs`
- [ ] Manual verify with user's provider (LM Studio / llmster) on long Plan/Orchestrate turns

## Summary

User-facing error:

`Could not complete this reply: Failed to execute 'close' on 'ReadableStreamDefaultController': Unexpected non-whitespace character after JSON at position N (line 71 column 2)`

## Root cause

1. **Primary:** After streaming, when no assistant text was extracted, `tryNonStreamingFallback` in `src/api/chat.ts` called `res.json()` on a `Response` whose body is still **SSE text** from `postChatCompletions` → generations replay. `JSON.parse` on `data: {...}\n\n...` throws the exact SyntaxError, often surfaced via stream `close`.

2. **Contributing:** Line-based `\n` splitting (not `\n\n` event boundaries) and single-line `data:` parsing missed multi-line / chunked SSE events, increasing empty-text fallbacks.

## Fix (2026-05-25)

| Area | Change |
|------|--------|
| `src/api/sse-parse.ts` | New shared SSE framing + `parseCompletionResponseBody` |
| `src/api/chat.ts` | `tryNonStreamingFallback` uses `res.text()` + parser; stream uses `feedSseEventBuffer` |
| `server/generations/store.js` | Leading `\n\n` before terminal `event: end` |
| Consumers | sub-agent, benchmark driver, reef widget |

## If errors persist

- Confirm provider path is OpenAI-compatible (`/v1/chat/completions`), not LM Studio 0.4 native `/api/v1/chat` event schema.
- Capture raw bytes from `GET /api/generations/:id/stream` for one failed turn.
- Check for empty stream + tool-only turns (fallback should now succeed when upstream returns JSON).
