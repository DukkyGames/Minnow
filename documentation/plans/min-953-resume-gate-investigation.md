# PR #953 resume gate — investigation

**Branch:** `claude/crash-recovery-chat-prompt-dd237d`  
**Worktree:** `~/.cursor/worktrees/crash-recovery-c70b26fa`  
**Status:** OPEN, not merged. Main still auto-resumes chats with no prompt.

## Reported symptom

Quit mid-chat (Quit Minnow **or** Task Manager kill) → reopen → **no** “Resume interrupted work?” popup. The same chat opens and shows as active in Agent Activity.

## Verdict

The popup only appears when boot finds **resume candidates**. For a normal mid-chat quit, those candidates are often **missing** (or cleared on clean quit), so the gate correctly takes the “nothing pending → no prompt” path — while Agent Activity can still look “live” from a leftover `currentGenerationId`, and/or the user may have been running **main** (which still calls `bootGenerationResumeForChats` with no gate).

## How the gate decides

Candidates = active chat with `currentGenerationId` **or** incomplete tool batch at history tail, **plus** orchestrate boards that would wake/auto-run (`src/boot/resume-gate-boot.ts`).

No candidates → `setResumeGateState('resumed')`, board repair/resume only, **no modal**, no chat generation/tool resume from the gate.

## Root causes (ordered)

### 1. Main still has the old auto-resume (test hygiene)

`main` wires:

- `await bootGenerationResumeForChats(...)`
- `await bootIncompleteToolResumeForChats(...)`
- `await bootOrchestrateBoardResume(...)`

with **no** prompt. That matches “chat restarts + Agent Activity active” exactly.

**Confirm:** package/run the PR branch (or this worktree), not `main`.

### 2. Clean Quit clears the generation id before persist

Electron `before-quit` → `deleteGenerationsForProviderShutdown()` aborts streams → renderer AbortError path clears `chat.currentGenerationId` → `pagehide` flush writes the cleared session.

Reopen: no generation candidate → **no popup**. (Incomplete tools may still qualify if history still shows a pending batch.)

### 3. `currentGenerationId` often never lands in a PATCH

Setting the id uses `scheduleSaveSessions()` **without** `touchChat()` (`src/tools/loop.ts` ~973–977).

After the user-message save clears dirty sets, a slow `createGeneration` can set the id with **no dirty marker** → production PATCH early-returns (“nothing dirty”) → id never hits `~/.minnow`.

Force-kill mid-stream then also finds **no** candidate.

### 4. Id is cleared between stream rounds (tool phase)

Successful `streamCompletionTurn` clears `currentGenerationId` as soon as the SSE round ends, **before** tools run. Most of an agentic “mid chat” has **no** generation id — only incomplete-tool detection can still make a candidate.

### 5. Chat-switch resume bypasses the gate

`bootGenerationResumeForChat` from `sidebar.ts` / experts does **not** check `isResumeGateHeld()`. A leftover id on a non-active chat can still resume on focus without a boot prompt. Agent Activity lists **any** chat with a generation id, not only the active one the gate considers.

### 6. Tests gap

Gate tests cover boards + a synthetic generation id; they do **not** cover dirty-tracking persistence, clean-quit abort clearing, tool-phase gaps, or `clearStaleGenerationIdsOnLoad` interaction.

## Todos

- [x] Confirm how the failing build was run (PR branch / worktree vs `main` / packaged app)
- [x] Reproduce analysis: graceful Quit clears generation id; gate had no candidate
- [x] Fix: `touchChat(chat)` whenever `currentGenerationId` is set or cleared (loop)
- [x] Fix: persist `resumeInterrupted` mid-turn; stamp on Quit before generations die
- [x] Fix: gate collects interrupted chats; decline/resume clears marker
- [x] Fix: gate (hold) sidebar generation/tool resume while `isResumeGateHeld()`
- [x] Fix: Stop / flush-stopped clears interrupt marker (no ghost Agent Activity)
- [x] Add tests: interrupted candidate, shutdown stamp, decline clears marker
- [ ] Manual E2E: Quit Minnow mid-chat → reopen → prompt → Don't resume stays stopped
- [ ] Re-run PR CI (typecheck+tests were failing on win/ubuntu/mac before this fix)

## Questions for product alignment

1. ~~Should **Quit Minnow** (graceful) still prompt even when generations were cancelled and the id was cleared?~~ **Yes** — addressed via `resumeInterrupted`.
2. Should the prompt cover **tool-running** gaps (no generation id) even when the tool batch looks complete on disk? — covered when `resumeInterrupted` was stamped at turn start.
3. Should **non-active** chats with leftover generation ids be listed in the boot prompt, or only cleared/stopped? — interrupted markers on any chat are listed; Resume still only reconnects the active chat.
