# Plan: `/loop` built-in slash command

Session-scoped repeating prompts in the live chat (complement to `/goal` and the Scheduler app).

## Todos

- [x] Parser + `ActiveLoopState` + session accessors + `/loop` dispatch
- [x] `sendProgrammaticChatText` refactor (slash/skill resolution for fires)
- [x] Fixed-interval ticker (15s scan, idle gate, expiry, one-fire-per-chat)
- [x] Self-pacing (`maybeRescheduleLoopsAfterTurn`)
- [x] Maintenance `/loop` + `.minnow/loop.md` fallback
- [x] Slash registry + composer hint + `/clear` + goal exclusivity
- [x] Tests: parse / ticker / pacing / command
- [x] `documentation/context.md` update
- [x] Chat loop panel + composer hint removed; list/stop slash subcommands removed
- [ ] Optional polish: "loop #n" badge on loop-fired user rows
- [ ] Manual verification checklist (see below)

## Summary

| Piece | Location |
|-------|----------|
| State | `ActiveLoopState` on `chat.activeLoops` |
| Parser / command | `src/chat/loop/parse-command.ts`, `command.ts` |
| Ticker / pacing / maintenance | `src/chat/loop/ticker.ts`, `pacing.ts`, `maintenance.ts` |
| Programmatic send | `sendProgrammaticChatText` in `src/tools/loop.ts` |
| UI | `src/ui/loop-status.ts` |

## Manual verification

1. `/loop 1m say the current time` — arms, fires within ~15s, then ~every minute while idle
2. Manual message mid-interval — loop defers until idle
3. Loop panel in chat — countdown, edit interval, stop with ×; list/stop slash removed
4. Auto loop — `currentDelayMs` doubles when output unchanged
5. `/loop 2m /simplify` — skill body applied each fire
6. Reload mid-loop — resumes from persisted `dueAt`
7. `/goal` while loop active (and reverse) — blocked
8. `/clear` — loops removed
