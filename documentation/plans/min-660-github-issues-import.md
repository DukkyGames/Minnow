# MIN-660 — GitHub issues import must not brick the SPA

## Goal

Importing GitHub issues into Minnow Issues either succeeds or fails with a recoverable error. A failure must never freeze the shell (file tree, chat, navigation) or show a raw `server_off` / `server OFF` string.

## Todos

- [x] Map `server_off` / fetch failures to **Open or restart Minnow** copy (MIN-529)
- [x] Make `importGithubIssues` and `/api/git` issue ops never throw to the UI
- [x] Do not mark the local tool server unavailable on a GitHub-op failure (that bricks the file tree)
- [x] Wrap `gh()` so timeouts / missing binary return `{ ok: false }` instead of HTTP 400
- [x] Settings import button always re-enables and shows an in-app error
- [x] Tests for error copy, import success, and server-side issueList failure
- [x] Settings Issues first paint is safe before `loadIssuesFromStorage()` (no status-pill throw)
- [x] Import is disabled until the issues store is loaded; uninitialized store is not a `gh` call
- [x] Update `documentation/context.md`

## Root cause

1. Settings → Issues **Import issues from GitHub** alerts `result.error` verbatim. When the tool server is down that is the internal code `server_off`.
2. `forge()` and `importGithubIssues` can throw (`requireIssueStatusForRole`, JSON parse, `gh` timeout). The click handler has no `.catch()`, so the rejection is unhandled.
3. `gh()` rejects on timeout / ENOENT. `/api/git` turns that into HTTP 400 and the client shows `HTTP 400`, dropping the real reason.
4. GitHub-op network failures must **not** call `setLocalServerAvailable(false)` — that flag is what empties the file tree until restart.
5. Settings → Issues called `getIssuesSnapshot()` / `getNextIssueIdPreview()` on first paint. If boot had not finished `loadIssuesFromStorage()`, that throw became the status pill (`issuesState is not initialized`) and looked like a frozen shell.

## Acceptance

- Failed import shows an error dialog; the rest of the app still works.
- Tool-server-down copy is **Open or restart Minnow and try again.**
- Successful import still creates Triage cards (`source: 'github'`).
