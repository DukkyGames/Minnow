---
name: min-empty-runtime-log-on-reload
overview: "Local Server Runtime log is empty after eject then reload because the SSE follow snapshots the serve before llama-server has a runId."
todos:
  - id: live-log-path
    content: Follow the serve's current log path (wait for runId; switch if spawn retries)
    status: completed
  - id: client-rebind
    content: Rebind the log EventSource when runId appears; do not skip bind during in-flight card patches
    status: completed
  - id: tests
    content: Cover follow-before-runId and runId change in serve-logs tests
    status: completed
  - id: docs
    content: Note the live log-path follow in documentation/context.md
    status: completed
isProject: false
---

# Empty runtime log after eject + reload

## Symptom

On Local Server, the first llama.cpp load fills **Runtime log**. Eject, load the same model again, and the pane stays empty even though the process is writing a new `~/.minnow/logs/models/{runId}.log`.

## Why first load works

`startServe` commits `status: 'starting'` **before** `createBackgroundRun` assigns `runId`. The Models store's serve SSE fires immediately. First load usually starts from My Models, so Local Server mounts a moment later — by then `runId` exists and `/logs/stream` follows the real file.

After eject the user is already on Local Server. The next `llama-starting` event paints a loading card and opens EventSource **before spawn**. `subscribeServeLogForServe` snapshots `runId: null`, returns a no-op follow, and `bindLogStream` keeps that connection because the serve id did not change. Load-card patches skip a full redraw, so the stream never reconnects.

A port/Jinja spawn retry also assigns a **new** `runId`; a connect-time snapshot would keep following the dead first file.

## Fix

1. Server: resolve the log path on each follow tick (wait until `runId` exists; switch files if it changes).
2. Client: treat `serveId` + `runId` as the stream identity, and still bind during in-flight card patches.
