# Feature 22 — Stream persistence across reload (verification)

| Field | Value |
|-------|-------|
| **Feature** | `feature-22-stream-persistence-reload` (backlog **C5**) |
| **Automated** | `npm run build`; `npm test` (includes `test/state/pending-turn.test.mts`, `test/state/pending-turn-recovery.test.mts`) |

## Acceptance criteria

| # | Check |
|---|--------|
| AC1 | Mid-stream: `pendingTurn` debounced ~150ms; `pagehide` flush while `streaming` |
| AC2 | Hard reload: user msg + partial assistant + Continue/Discard banner |
| AC3 | Discard clears `pendingTurn`; history-only render |
| AC4 | Continue starts new completion; `pendingTurn` cleared on stream connect |
| AC5 | Normal complete clears `pendingTurn` before final assistant in `history` |
| AC6 | Client + server validators preserve valid `pendingTurn` |
| AC7 | `localStorage` fallback same as server blob |
| AC8 | Stop then reload: `stopped: true`; no duplicate assistant in `history` + `pendingTurn` |

## Manual QA (U1–U7)

| Step | Expected |
|------|----------|
| U1 | `npm start`, send long reply — stream visible |
| U2 | Hard reload mid-stream — partial + banner |
| U3 | Discard — partial gone; user msg remains |
| U4 | Reload → Continue — new stream completes; no `pendingTurn` in `sessions/state.json` |
| U5 | Reload during tool loop — checkpoint reflects last save |
| U6 | Vite-only (`npm run dev`) — same with `minnow-sessions-v1` |
| U7 | Stop mid-stream, reload — `stopped: true`; banner works |

## Sign-off

- [x] Automated green (`pending-turn*.test.mts`, full `npm test`) — 2026-05-20
- [ ] Manual U1–U7
- Commit: `9860d41`
