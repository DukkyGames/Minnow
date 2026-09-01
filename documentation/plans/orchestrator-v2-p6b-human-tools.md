# P6-B — human-gated tools audit (MIN-724)

**Date:** 2026-08-31  
**Question:** which tools hang unless a human is present, and does `AskCapability` cover them?

`ask_question` is the injected capability on `runTurn({ ask })`. The other
human-gated paths are **out of scope** for P6-B. They must not silently hang
an unattended board turn.

## Injected (this phase)

| Tool | Hang risk | P6-B |
|------|-----------|------|
| `ask_question` | Composer question cards (`enqueueAskQuestion`) | **Injected.** Capability present → schema on the resolved list, handler + `askTimeoutMs` watchdog. Capability `null` → schema stripped; a fabricated call returns `Error:` immediately (never waits on `askTimeoutMs`). |

## Out of scope — no hang on the board path today

These wait on a human **only in renderer `executeTool`**. Board attempts use
`createInProcessToolDispatch` → `executeServerTool`, which never opens a modal.

| Path | What it does | Why boards do not hang |
|------|----------------|------------------------|
| [`enqueueToolApproval`](../../src/tools/approval-queue.ts) / [`maybeBlockToolForUserApproval`](../../src/tools/permission-gate.ts) | Permission / path-ack / companion Ask strip | In-process dispatch does not call this. Settings `ask` on a server tool is not a modal on the board effector. |
| [`applyDestructiveConfirmationAfterUserApproval`](../../src/tools/destructive-tool-confirm.ts) | Sets `confirmed: true` after the Ask strip | Not a wait. It only mutates args **after** a renderer approval. |
| `propose_mode_switch` | Mode-handoff cards via `enqueueAskQuestion` | Renderer-only; absent from `DEFAULT_HEADLESS_TOOL_IDS`. A fabricated name hits `executeServerTool` → `Not implemented` (immediate). |
| `request_browser_origin_access` | Allowlist consent cards | Same as above. Final-Tester browser tools are a different driver (Phase 5). |

## Hang that would return if a caller used interactive execute

If P6-C (or Phase 8) pointed an **unattended** `runTurn` at renderer
`executeTool` without `ask: null` and without skipping approval, then:

- `ask_question` is already covered (strip + immediate error).
- `maybeBlockToolForUserApproval` could still wait on `enqueueToolApproval`
  with **no AbortSignal and no timeout** (finding E / P8-A already named this).
  That is a **caller** contract: unattended execute stays in-process; chat
  keeps interactive execute. Do not add an `isBoard` branch in the runner to
  skip approvals.

P6-C should keep that split. A future `ApprovalCapability` would match this
pattern; it is not required to land AskCapability.

## Timeout

Interactive `ask()` is wrapped in `runTurn` with `askTimeoutMs` (default
`DEFAULT_ASK_TIMEOUT_MS` = 60 minutes, same as Watchdog
`chat.generationIdleTimeoutMs`). Composer Stop is `options.signal`. The
`null` path does not start this timer.
