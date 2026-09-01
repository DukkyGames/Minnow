# Sub-agent transcript, completion, and Agent activity

Plan copied from the Cursor plan *Sub-agent transcript fixes*. Three bugs share one gap: the P8 server runner does the work, but the drawer/store never received a transcript or a usable completion.

## Todos

- [x] **transcript-disk** — Generalize P9-D `transcripts.js` for an injected `entryDir` (boards keep `~/.minnow/boards/<id>/attempts/`; agents use `~/.minnow/agents/<parentChatId>/attempts/`). Record from the sub-agent `onEvent` path. Serve `GET /api/agents/:runId/transcript`.
- [x] **drawer-paint** — Hydrate the overlay from that transcript. Accumulate `tool_call` / `tool_result` / `round_end` onto `run.messages`. Show throttled `livePartialText` so **Generating response…** is never an empty row.
- [x] **fold-merge** — Fold-derived `summary` / `status` / `error` / `foldAttemptCount` win over sticky empty client overlays. `listActiveSubAgentRuns` is `running`, or `queued` only when `foldAttemptCount === 0`.
- [x] **completion-delivery** — Production `buildMessage` is `buildProductionParentMessage` (type, status, last summary / abandon evidence). Effector maps prose-only `no_report` to a degraded pass (`degradeNoReportIfProse`). Empty `no_report` still retries then abandons.
- [x] **tests-docs** — Store merge, delivery copy, live accumulation, activity drop, GET transcript, mapper, generating tail. Update `documentation/context.md` and this plan.

### Follow-up (empty overlay)

- [x] **sse-auth** — Production `ensureClient` opens EventSource with `withSessionToken`; tests still inject `setSubAgentOpenStreamForTests`.
- [x] **placeholder** — Do not paint `legacyOutcomeFromSummary('')` as a structured outcome. Activity stays open unless a real fold summary / `structuredOutcome` exists. Terminal empty uses the fold error or a short honest line.
- [x] **mapper** — Map coalesced `thinking` onto assistant `reasoning` and `attempt_end.summary` onto assistant content when no later prose exists. Effector records a synthetic `round_end` when `degradeNoReportIfProse` finds in-memory assistant prose (does not promote raw thinking to a pass).
- [x] **tests-docs** — Store hydrate, drawer Activity, aggregate/status, `transcript-messages`, tsc. `documentation/context.md` EventSource token + overlay rules.

## Out of scope (kept)

- V1 heartbeat / stall supervisor.
- Journaling tokens.
- `isSubAgent` / prose scrape inside `server/runner/`.
- Board UI, except the shared `transcript-messages.js` mapper.

## Why this is the sink, not the runner

`runTurn` already emits `TurnEvent`s. Memory transcripts already exist for continue-seeds. Live SSE was status-only (`shouldEmitSubAgentLiveTurnEvent('delta') === false` on purpose). The fold has no `messages` field. Merge used `??`, so `summary: ''` masked a later fold summary. Production delivery was ids-only. Policy retried empty `no_report` then abandoned.

Disk JSONL + live accumulation + fold-wins merge + effector-only degraded pass close the three UI bugs without putting tokens on the journal.
