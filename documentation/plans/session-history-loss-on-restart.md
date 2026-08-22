# Session history loss on failure / restart

## Problem

Two reported symptoms, one shared cause chain:

1. **"Continue after a failure or restart and the model loses everything."** The transcript is
   still on screen but the outbound API messages no longer contain it.
2. **"Sometimes the whole chat disappears."** Chats stay in the sidebar with their titles, runs
   and timestamps, but the transcript is gone — permanently.

## Evidence

Forensics on the live store (`~/.minnow/sessions/sessions.db`, read-only) against the
`sessions.db.bak-shrink-2026-08-09` snapshot:

| | Aug-9 snapshot | Live DB |
|---|---|---|
| chat rows | 203 | 220 |
| message rows | 7,385 | 1,697 |
| `messages_fts` rows | — | 14,113 |

- **Every chat that existed on 2026-08-09 lost its entire transcript.** Bucketed by
  `last_message_at`: 129 chats lost, **0 kept**. Only chats created on/after 2026-08-18 still
  have messages.
- 64 further chat rows present on Aug-9 are gone from the live DB entirely.
- 129 of the emptied chats still carry `chat_runs` rows (one has 16), `last_message_at > 0` and a
  real title — so they were not cleared by `clearChat()`, which zeroes `lastMessageAt`.
- **12,416 orphaned `messages_fts` rows.** `syncMessages` always deletes from `messages` and
  `messages_fts` together, so the message rows did **not** disappear through the normal write
  path. The only thing that removes `messages` without touching the FTS index is the `chats`
  FK cascade — i.e. `DELETE FROM chats`.

That fingerprint (chat row present, runs present, messages gone, FTS orphaned) means:
**the chats were deleted, then re-inserted by a client that held them in memory but had never
hydrated their history.**

## Root causes

### D1 — A whole-blob PUT is authoritative and deletes by absence

`server/config/sessions-repo.js:682` — `writeWholeSessionState` ends with
`DELETE FROM chats WHERE id NOT IN (...)`. Any client that PUTs a session blob deletes every chat
it does not happen to list. Cascade removes `messages` and `chat_runs`; `messages_fts` is not
cascaded (the orphans above). There is no concurrency guard: `baseVersion` is only range-checked
as a schema number, never compared against stored state.

`src/config/api-client.ts:282` — `flushSessionsOnShutdown` falls back to
`putSessionsKeepalive(fullState)` and then returns `clearedOk: true` **unconditionally**, even
though the same file documents around line 32 that keepalive bodies over 64 KiB are silently
dropped by Chromium. A full session blob is far over that. So every shutdown either (a) silently
drops the write while the client clears its dirty sets, or (b) lands a whole-blob
delete-by-absence PUT from whichever window quit last.

### D2 — Degraded client state is still marked "hydrated"

`src/state/sessions.ts:1470-1491`:

- `sessionStateFromSummaries` calls `parseSessionStateFromJson`, which returns
  `defaultSessionState()` — a **single empty chat** — for any unexpected version or shape.
- `sessionsHydratedFromServer = true` is then set unconditionally, and that flag is the only thing
  the MIN-408 guard in `saveSessionsNow` checks. The next flush full-PUTs that one-chat state,
  which on the server is `DELETE FROM chats WHERE id NOT IN ('<one id>')`.
- `await ensureChatHistoryLoaded(activeId)` sits **inside** the same try. One failed history GET
  (server still coming up after a restart — exactly the reported trigger) discards the entire
  parsed session and replaces it with `defaultSessionState()`. That is the "whole chat
  disappears" screen.

### D3 — Resurrected chats come back without messages

`chatForSessionsWire` (`src/state/sessions.ts:319`) omits `history` when
`historyLoaded === false` so the server preserves existing rows. But the server's preserve path,
`readChatMessageDerived` (`server/config/sessions-repo.js:388`), returns `{ messageCount: 0 }`
when the chat row is **missing**. After D1/D2 deleted a chat, the next PATCH re-inserts it with
metadata and runs from the client wire payload and **zero messages, forever**. That is precisely
the 129 chats.

### D4 — Sending while lazy hydrate is in flight discards the turn

`materializeChatHistory` (`src/state/sessions.ts:669`) replaces `chat.history` with the server
response whenever `incoming.length >= current.length`. The guard only covers the case where the
local array is longer. When a chat is unloaded (`current = []`) and the user hits **Continue** or
sends while the history GET is in flight, the server payload overwrites the array the running turn
already appended to. The bubble is on screen; the row is gone from `chat.history`; and
`buildApiMessages` (`src/tools/loop.ts:764`) never sees it.

**This is symptom 1: the conversation is visible, the model's copy is not.**

The mirror case is just as bad: when the local array *is* longer, it sets `historyLoaded = true`
while keeping the 1-row local tail, which the next PATCH writes as the whole transcript.

### D5 — Boot resume reads and truncates unhydrated history

- `clearStaleGenerationIdsOnLoad` runs for the **active chat only**
  (`src/state/sessions.ts:1477`), so every other chat keeps a stale `currentGenerationId` across a
  restart.
- `src/main.ts:462` `bootGenerationResumeForChats(sessionState.chats)` resumes all of them. Each
  404s with `GENERATION_LOST_ON_RESTART_MESSAGE` and lands in the failure branch at
  `src/tools/loop.ts:2860`, where `rollbackFailedTurnHistory` truncates history and PATCHes it.
- `bootIncompleteToolResumeForChats` calls `findIncompleteToolBatchAtTail`, which reads
  `chat.history` without hydrating. On a lazy boot it always sees `[]` and silently skips the
  resume it exists to perform.
- `forkFromUserIndex` (`src/chat/fork-from-run.ts:60`) and `truncateChatHistory`
  (`src/chat/history-truncate.ts:61`) read `chat.history.length` with no
  `ensureChatHistoryLoaded`. The **"Clear last failed turn"** recovery button therefore reports
  "Invalid message" on an unhydrated chat — the recovery affordance is broken in exactly the
  situation it exists for.

### D6 — Archive collapse index drift (secondary, policy `archive` only)

`replaceArchivedRangesWithPlaceholder` (`src/chat/archive/collapse.ts:41`) assumes history index
`i` maps to API index `systemEnd + i`. `buildApiMessages` skips `isUiOnlyTranscriptMessage` rows,
and `foldLeadingAssistantPreamble` / `repairUnpairedToolCalls` change the count. Any drift makes
the placeholder swallow live turns — again, UI complete, model context missing. Separately,
`detectStaleTurnRanges` archives turns older than `stalenessTurns` (20) **by age alone**, with no
context pressure.

### D7 — JSON store mode wipes history on PUT (latent)

`server/config/store.js:447`: the `useJsonSessionsStore()` branch writes
`validateSessionState(body)` straight to disk with no `rawChats` history-key detection.
`normalizeChatRow` turns every history-omitted chat into `history: []`. Only reachable with
`MINNOW_SESSIONS_STORE=json`, but it is an unguarded total wipe.

## Approach

Stop inferring deletion from absence, never write state we did not fully load, and make every
history read hydrate first.

### Phase 1 — Stop the bleeding (server)

- `writeWholeSessionState`: drop `DELETE FROM chats WHERE id NOT IN (...)`. Make PUT upsert-only.
  Deletion happens only through PATCH `deleteChatIds`, or through an explicit
  `pruneMissingChats: true` flag the client sets only when it can prove it holds the full list.
- Add a refuse-and-log guard: reject any write that would drop total `message_count` by more than
  10%, or remove more than N chats, without the prune flag.
- Real optimistic concurrency: a monotonic `revision` in `session_meta`, bumped on every write.
  PUT/PATCH carry the revision they read; mismatch returns 409. The client re-hydrates and retries
  instead of clobbering. This kills the two-window / restart-overlap race.
- `upsertChatWithOptionalHistory`: when `syncHistory === false` **and no chat row exists**, do not
  create a zero-message chat — that is the D3 resurrection. Reject and let the client re-send with
  history.
- Delete `messages_fts` rows wherever a chat is deleted (FK cascade does not reach FTS).
- Fix D7: give the JSON branch the same `rawChats` history-key detection as the sqlite branch.

### Phase 2 — Never write unhydrated state (client)

- `saveSessionsNow`: if the full-PUT fallback is selected while **any** chat has
  `historyLoaded === false`, do not send a whole-blob body. Hydrate first, or downgrade to a PATCH
  of the dirty chats.
- `loadSessionsFromStorage`: set `sessionsHydratedFromServer = true` only when the parse actually
  produced the remote chat list (compare against `remote.chats.length`). A degrade to
  `defaultSessionState()` is a load *failure*, not a hydrate.
- Move `await ensureChatHistoryLoaded(activeId)` out of the summaries try/catch so one history GET
  failure cannot discard the whole session. Surface it as a per-chat error.
- `flushSessionsOnShutdown`: stop reporting `clearedOk: true` for a keepalive PUT it cannot
  confirm. Measure the body; over `FETCH_KEEPALIVE_MAX_BYTES`, send per-chat PATCH beacons and
  return `clearedOk` from what actually queued.

### Phase 3 — Fix the hydrate race (D4)

- `materializeChatHistory` must **merge, not replace**. Record a fetch epoch when the GET starts;
  if the turn appended rows since, splice the local tail onto the incoming history rather than
  dropping either side.
- Never flip `historyLoaded = true` while holding a history shorter than the server's
  `messageCount`.

### Phase 4 — Hydrate before every history read (D5)

- `await ensureChatHistoryLoaded` in `forkFromUserIndex`, `truncateChatHistory` /
  `resendFromIndex`, the `findIncompleteToolBatchAtTail` callers, and
  `clearStaleGenerationIdsOnLoad`.
- Boot resume: resume only the **active** chat; background chats resume on activation. Clear stale
  generation ids for the rest without touching their history.
- In the `GENERATION_LOST_ON_RESTART_MESSAGE` branch of `src/tools/loop.ts:2860`, do **not** call
  `rollbackFailedTurnHistory` — nothing was produced, so slicing can only lose. Keep the user row
  and offer retry.
- Promote the DEV-only `installUnloadedHistoryTrap` to a hard `requireHistory()` throw in every
  history mutator, not just the "category-3" call sites.

### Phase 5 — Recovery

`scripts/recover-session-messages.mjs`, dry-run by default:

- Source: `~/.minnow/sessions/sessions.db.bak-shrink-2026-08-09`.
- For every live chat with `message_count = 0` that has a non-empty history in the backup, restore
  `messages` and `messages_fts`, then recompute `message_count` / `history_digest` /
  `last_message_preview`.
- Re-insert the 64 chat rows that are gone entirely.
- **Recoverable: 129 chats / 5,390 messages, plus 64 chat rows.**
- Rebuild `messages_fts` from `messages` afterwards to clear the 12,416 orphans.

### Phase 6 — Guardrails

- Rotating DB snapshot on boot. The JSON mirror is skipped over a size cap, so it is not a backup.
- Log every write that reduces total message count, with the caller and the affected chat ids.

## Todos

- [x] Server: PUT upsert-only + explicit prune flag
- [x] Server: `revision` optimistic concurrency, 409 on mismatch
- [x] Server: refuse zero-message resurrection of a missing chat row
- [x] Server: cascade `messages_fts` on chat delete; fix JSON-store PUT
- [x] Client: never full-PUT with unhydrated chats
- [x] Client: degraded parse is a load failure, not a hydrate
- [x] Client: history GET failure must not discard the session
- [x] Client: honest `clearedOk` from `flushSessionsOnShutdown`
- [x] Client: `materializeChatHistory` merges instead of replacing
- [x] Client: hydrate before fork / truncate / resume / stale-gen-id sweep
- [x] Client: no rollback on `GENERATION_LOST_ON_RESTART`
- [x] D6 archive index drift: outbound messages carry their history row
- [x] Tests: delete-by-absence, two-client race, mid-flight append, >64 KiB shutdown flush
- [x] Update `documentation/context.md`
- [ ] ~~Recovery script + FTS rebuild~~ — dropped; the affected chats were deleted by hand
- [ ] Guardrail: rotating DB snapshot on boot (the JSON mirror is size-capped, so it is not a backup)

## What shipped

Phase 5 (recovery) was dropped at the user's request — the emptied chats were
deleted rather than restored. The `messages_fts` orphans they left behind go with
them.

One guardrail is still open: there is no real rotating backup of `sessions.db`.
The JSON mirror skips itself above a size cap, so a large store has no snapshot at
all. Everything else in Phases 1-4 and 6 is implemented and covered by
[`test/config/sessions-history-loss.test.js`](../../test/config/sessions-history-loss.test.js),
[`test/state/session-persistence.test.mts`](../../test/state/session-persistence.test.mts),
[`test/state/lazy-history.test.mts`](../../test/state/lazy-history.test.mts) and
[`test/chat/archive/collapse-index-drift.test.mts`](../../test/chat/archive/collapse-index-drift.test.mts).
