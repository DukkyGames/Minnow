# Chat & session storage: JSON blob → SQLite

## Status

- **Worktree:** `sessions-sqlite-351ecd68` → `%USERPROFILE%\.cursor\worktrees\sessions-sqlite-351ecd68`
- **Start ref:** `HEAD` (`d8a8af1b`)
- **Approach:** Phased A → B → C; each independently shippable. Implementation via subagents; verify after all phases.

## Todos

- [x] **A.0** — Validator passthrough + remove `MAX_CHATS` + kitchen-sink fixture + parity test
- [x] **A.1** — Schema + `sessions-db.js` + `sessions-import.js` + import tests (nothing reads DB yet)
- [x] **A.2** — `sessions-repo.js` whole-blob R/W + `store.js` cutover + allowlist removal + export-json + JSON mirror
- [x] **A.3** — Eight server consumers → narrow queries
- [ ] **B.0** — Validator decomposition + `PATCH /api/config/sessions` + headless convert
- [ ] **B.1** — Shared `session-schema.mjs` + dirty tracking (telemetry only)
- [ ] **B.2** — Flip to PATCH + beacon size branch
- [ ] **C.1** — Summaries + `ensureChatHistoryLoaded` + dev trap (flag off)
- [ ] **C.2** — FTS5 search route, delete `task-history-trim.ts`, flip flag
- [ ] **Docs** — Update `context.md`, architecture/configuration guides, `server-session-engine.md`
- [ ] **Verify** — Full test suite + e2e reload survival checks

## Context (summary)

Today: `~/.minnow/sessions/state.json` (~2.74 MB). Full-blob rewrite on every save; hot server paths parse+validate the whole file; three writers with no cross-process concurrency; `ensureChatShape` silently drops 16 Chat fields; `MAX_CHATS=50` hard-deletes.

**Outcome:** SQLite (`better-sqlite3`), row-per-message, indexed point lookups, writes proportional to change, no silent truncation, lazy history (Phase C).

Full specification: see the chat prompt that authored this plan (schema tables, import rules, consumer map, verification matrix, PR sequence, risks/rollback).

## Decisions

- Row per message `(chat_id, seq)`; remove `MAX_CHATS` entirely
- Compatible with but independent of `server-session-engine.md` (no `rev`/`If-Match` here)
- Follow `server/email/store.js` + `email/cache.js` migration patterns
- `messages.payload_json` verbatim; server owns `terminalHistory` on whole-blob PUT
- Two version axes: `SESSION_SCHEMA_VERSION=6` (wire) vs `PRAGMA user_version` (DDL)

## Merge / cleanup

- Merge back: `/apply-worktree`
- Cleanup: `/delete-worktree`
