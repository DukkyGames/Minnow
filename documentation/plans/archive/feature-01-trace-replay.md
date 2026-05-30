# Feature 01 — Trace and replay manual QA

## Prerequisites

- `npm start` with a loaded LM Studio (or compatible) model
- `~/.minnow/sessions/state.json` writable

## Checklist

1. **Normal send** — Send a user message and wait for a reply. Open `state.json` and confirm `chats[n].runs[0]` has `snapshot` fields and `outputMessages` (or output index range) after completion.
2. **Replay** — On a user bubble, open ⋮ → **Replay**. Confirm a new run is appended, prior run is `superseded`, and the branch pill shows **▾ 2 branches** when both runs completed.
3. **Branch switch** — Select the other branch from the pill menu. Transcript updates without a new LLM request.
4. **Fork with different model…** — Choose another model in the dialog and fork. Confirm the new branch snapshot `modelId` / `providerId` match the selection (stats strip or `state.json`).
5. **Remake** — From an assistant bubble, **Remake** creates a new run at the preceding user fork.
6. **Delete message** — Delete from a user row; invalid branches disappear from the picker; no console errors.
7. **Reload mid-stream** — Start a reply, reload with `currentGenerationId` set; stream resume still works; run finalizes on complete/stop.
8. **Streaming guard** — While streaming, Replay / branch switch / fork show “Finish or stop the current reply first”.

## Automated

```bash
npm test -- test/chat/runs-store.test.mts test/chat/turn-snapshot.test.mts test/chat/fork-from-run.test.mts test/ui/branch-picker.test.mjs
npx tsc --noEmit
```
