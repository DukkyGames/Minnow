---
title: "MIN-409 — Agent undo system"
linear: MIN-409
branch: henri/min-409-28agent-undo-system
status: plan
todos:
  - id: p1-prune-preserve
    content: "Phase 1: Fix pruneSupersededRunsAfterTruncate to keep outputMessages (and keep superseded runs activatable for redo)"
    status: completed
  - id: p1-undo-turn-api
    content: "Phase 1: Add src/chat/undo-turn.ts — resolveUndoTarget, canUndoTurn, undoLastAgentTurn (chat rewind only)"
    status: completed
  - id: p1-branch-picker-redo
    content: "Phase 1: Show branch picker at fork when history ends at user row and ≥1 activatable run exists (single-branch redo)"
    status: completed
  - id: p1-ux-menus
    content: "Phase 1: Wire Undo into message ⋮ menu + Code composer control; block streaming/orchestrate/board/worktree"
    status: completed
  - id: p1-tests-chat
    content: "Phase 1 tests: runs-store prune/redo, undo-turn unit, history-truncate integration, branch-picker single-branch"
    status: completed
  - id: p2-git-snapshot-ops
    content: "Phase 2: snapshotCreate / snapshotRestore / snapshotDiff in server/git/git-ops.js + middleware OPS + git-api.ts"
    status: completed
  - id: p2-turn-fields
    content: "Phase 2: TurnRunRecord snapshot SHA fields + ensureTurnRuns persistence (sessions.ts)"
    status: completed
  - id: p2-loop-hooks
    content: "Phase 2: Capture pre/post snapshots in loop.ts around createRun / finalizeRun"
    status: completed
  - id: p2-undo-files
    content: "Phase 2: Wire file restore into undo-turn (confirm changed files, safety snapshot, divergence guard)"
    status: completed
  - id: p2-redo-files
    content: "Phase 2: On activateBranch redo, optionally restore postTurnSnapshotSha with same guards"
    status: completed
  - id: p2-tests-git
    content: "Phase 2 tests: git-ops snapshot unit/integration, undo-turn file path, loop hook mocks"
    status: completed
  - id: ux-polish
    content: "UX polish: disabled tooltips, toasts, Desktop/Chat app parity decision, CSS tokens"
    status: completed
  - id: context-md
    content: "Update documentation/context.md Turn runs + git API sections"
    status: completed
  - id: acceptance
    content: "Run acceptance checklist (N-turn rewind, redo via picker, board blocked, no-git chat-only)"
    status: completed
---

# MIN-409 — Agent undo system

**Linear:** [MIN-409](https://linear.app/minnowai/issue/MIN-409/28agent-undo-system)  
**GitHub:** [#535](https://github.com/DukkyGames/Minnow/issues/535)  
**Worktree:** `C:\Users\dukky\.cursor\worktrees\min409-ee66a399`  
**Branch:** `henri/min-409-28agent-undo-system`

---

## Overview

Users cannot roll back a bad agent turn: chat history stays polluted and file mutations must be undone by hand. Minnow already has a turn-branch engine (`TurnRunRecord`, truncate, fork/replay, branch picker). This feature wires **Undo = rewind chat to the fork user message (no regenerate)** and, in Phase 2, **restores the working tree from per-turn dangling git snapshot commits**.

### Goals

1. Rewind chat **N turns** (repeated Undo) without losing the session or destroying the undone turn as a redoable branch.
2. Keep **Replay / Remake / Fork with different model** as the regenerate paths; Undo does not auto-resend.
3. Phase 2: restore files to the **pre-turn** tree via snapshot commits; make undo itself reversible via a safety snapshot; warn on HEAD divergence and confirm changed paths.
4. **Block** undo (with clear tooltip/status) for Orchestrate/board chats and worktree-isolated chats in v1.

### Non-goals (v1)

- Selective mid-history file undo / patch journal.
- Reverting board fan-out (worker chats, task status, integration merges).
- Auto-regenerate after undo (“Remake on undo”).
- Moving `HEAD` / creating user-visible branches for snapshots.
- Schema version bump of `sessions/state.json` (optional fields only; see persistence note below).
- Full Desktop / Chat-app composer chrome parity (Code composer + message menu are required; other surfaces may share the same `undoLastAgentTurn` entrypoint later).

---

## Architecture decisions

### A. Chat rewind reuses the branch engine

| Piece | Role | Path |
|-------|------|------|
| Turn model | `TurnRunRecord` + `TurnSnapshot` | `src/types.ts` |
| Run CRUD / branch switch | `createRun`, `finalizeRun`, `activateBranch`, `persistActiveBranchSuffix`, `pruneSupersededRunsAfterTruncate` | `src/state/runs-store.ts` |
| Truncate | Atomic assistant+tool slices; blocks while streaming | `src/chat/history-truncate.ts`, `src/chat/history-truncate-core.ts` |
| Regenerate | Truncate + `runChatTurn` | `src/chat/fork-from-run.ts` |
| **New** undo orchestration | Resolve target run, persist suffix, truncate, clear active branch, optional file restore | **`src/chat/undo-turn.ts`** (new) |
| Branch UX (redo) | Picker on user row | `src/ui/branch-picker.ts` |
| Message ⋮ | Copy / Edit / Replay / Remake / Delete | `src/ui/message-actions.ts` |
| Turn lifecycle | `createRun` ~L1550, `finalizeRun` ~L2581 | `src/tools/loop.ts` |

**Undo semantics (message-only):**

1. Identify the **last agent turn still materialized in history**: newest settled run (`completed` | `stopped`) whose `forkHistoryIndex` is a user row and whose outputs are still present after that index (or history length > fork+0).
2. Call `persistActiveBranchSuffix(chat, forkHistoryIndex)` so follow-up user/assistant rows after the initial reply are stored on that run’s `outputMessages`.
3. `truncateChatHistory(chatId, forkHistoryIndex, 'inclusive')` — **keeps the user message**, drops assistant/tool (and any later turns).
4. Ensure the undone run remains **activatable** (keep `outputMessages`; status may stay `completed`/`stopped` or become `superseded` — both are allowed by `isBranchActivatable` today).
5. Clear `activeBranchByFork[fork]` so the transcript is honestly “no active reply” while the picker offers redo.
6. Re-render chat; focus composer; **do not** call `runChatTurn`.

**Redo:** `activateBranch` via the existing branch picker (after the Phase 1 picker fix for single-branch forks).

### B. Why prune must change (critical bug for redo)

Today `pruneSupersededRunsAfterTruncate` (`src/state/runs-store.ts` ~232–262):

```ts
if (outStart !== undefined && outStart > cutIndex) {
  run.status = 'superseded';
  delete run.outputMessages;  // ← breaks redo
  ...
}
```

After inclusive truncate at the user row, `outputHistoryStart > cutIndex`, so prune marks the run superseded **and deletes `outputMessages`**. Then `isBranchActivatable` falls through to `outputHistoryStart/End` vs `chat.history.length`, which fails because the suffix indices are gone from history → **zero selectable branches**. The existing unit test `pruneSupersededRunsAfterTruncate marks runs past cut` asserts `listSelectableBranchesAtFork(...).length === 0` — that expectation must flip for undo/redo.

**Fix:** stop deleting `outputMessages`. Optionally still mark `superseded` and clear stale `outputHistoryStart/End` (indices are meaningless after truncate) while relying on `outputMessages` for activation. Update `activeBranchByFork` pruning so an undone fork is **not** kept as active when history has no suffix (see undo-turn step 5).

### C. File revert = dangling snapshot commits (Phase 2)

| Piece | Path |
|-------|------|
| Git ops | `server/git/git-ops.js` — add `snapshotCreate`, `snapshotRestore`, `snapshotDiff` (name flexible) |
| HTTP | `server/git/middleware.js` — register in `OPS` |
| Client | `src/state/git-api.ts` — thin `postGit` wrappers |
| Reference (hard reset style, **not** copy verbatim) | `restoreIntegration` in `server/worktree/worktree-ops.js` — abort/reset/clean pattern; our restore must **not** move branch/`HEAD` |

**`snapshotCreate({ cwd, message? })` algorithm:**

1. `requireGitRepo(cwd)`.
2. Temp index file under `os.tmpdir()` (unique per call); set `GIT_INDEX_FILE` via `runProcess(..., { env })` (already supported in `server/process-runner.js`).
3. Seed temp index from `HEAD` tree: `git read-tree HEAD` (with temp index).
4. `git add -A` (temp index) so untracked + modifications are included.
5. `tree = git write-tree` (temp index).
6. `head = git rev-parse HEAD` (real repo; no temp index).
7. `sha = git commit-tree <tree> -p <head> -m <msg>` → **dangling commit** (no ref update).
8. Delete temp index file in `finally`.
9. Return `{ ok, sha, headSha, treeSha }` (and optionally empty-tree / identical-to-HEAD flags).

**`snapshotRestore({ cwd, sha })` algorithm:**

1. Resolve `sha` to a commit; take its tree.
2. **Safety snapshot first** (call `snapshotCreate`) so the restore is undoable; return `safetySha` to the client.
3. Apply tree to working tree **without moving branch**: `git read-tree --reset -u <tree>` (updates real index + WT — intentional on restore) then `git clean -fd`.
4. Do **not** `reset --hard`, do **not** update `refs/heads/*`.

**`snapshotDiff({ cwd, fromSha, toSha })`:** `git diff --name-status fromSha toSha` (or `diff-tree`) for the confirmation dialog file list.

**Divergence guard:** store `headShaAtTurn` (HEAD at pre-snapshot). Before restore, `git rev-parse HEAD`; if different, warn that a real commit landed; user must confirm. Working-tree dirtiness after the post-turn snapshot is expected to be overwritten by restore (confirm via file list).

### D. Where snapshots attach

Optional fields on `TurnRunRecord` (`src/types.ts`):

```ts
preTurnSnapshotSha?: string;
postTurnSnapshotSha?: string;
/** HEAD tip when pre-turn snapshot was taken (divergence guard). */
headShaAtTurn?: string;
/** Absolute cwd used for snapshots (workspace or chat worktree). */
snapshotCwd?: string;
```

**Persistence caveat (issue text is slightly wrong):** server `validateSessionState` passes `runs` through as opaque objects (`server/config/validators.js` ~913–972). Client **`ensureTurnRuns` in `src/state/sessions.ts` allowlists fields** and **will strip** unknown SHA fields on load unless updated. No schema version bump required, but **client allowlist must be extended**.

### E. Orchestrator / board / worktree — blocked in v1

Helper in `undo-turn.ts` (or small `undo-eligibility.ts`):

| Condition | Detection |
|-----------|-----------|
| Orchestrate mode | `normalizeModeId(chat.modeId) === 'orchestrate'` |
| Board task / planner link | `chat.boardTaskId` or `chat.boardGroupId` |
| Worktree-isolated chat | `Boolean(chat.worktreeRoot?.trim())` (covers MIN-275 board workers **and** MIN-276 composer worktrees) |
| Streaming | existing `isChatStreaming` / `isActiveChatStreaming` |

UI: disable Undo control + `title` / status: e.g. *“Undo isn’t available for Orchestrate board or worktree-isolated chats yet.”*

---

## Exact APIs / types / functions

### Types — `src/types.ts`

Extend `TurnRunRecord` with optional snapshot fields listed above.

### Runs store — `src/state/runs-store.ts`

| Change | Detail |
|--------|--------|
| `pruneSupersededRunsAfterTruncate` | **Do not** `delete run.outputMessages`. Prefer clearing `outputHistoryStart` / `outputHistoryEnd` when they fall outside the new history. Keep status transition to `superseded` for runs whose outputs were cut. |
| Possibly export | `clearActiveBranch(chat, forkHistoryIndex)` or have undo clear the map entry directly. |
| `isBranchActivatable` | Already accepts `superseded` + `outputMessages`; verify after prune change. No change if prune keeps messages. |
| `listSelectableBranchesAtFork` | Unchanged filter; picker visibility changes separately. |

### New module — `src/chat/undo-turn.ts`

```ts
export type UndoBlockReason =
  | 'streaming'
  | 'orchestrate'
  | 'board'
  | 'worktree'
  | 'no_turn'
  | 'not_found';

export interface UndoEligibility {
  ok: boolean;
  reason?: UndoBlockReason;
  /** Human tooltip / status */
  message?: string;
  target?: { runId: string; forkHistoryIndex: number };
}

export function getUndoEligibility(chat: Chat): UndoEligibility;
export function canUndoTurn(chat: Chat): boolean;

export interface UndoTurnOptions {
  /** Phase 2: attempt file restore when SHAs present */
  restoreFiles?: boolean;
  /** Skip confirm dialogs (tests) */
  confirm?: (info: UndoConfirmInfo) => boolean | Promise<boolean>;
}

export interface UndoTurnResult {
  ok: boolean;
  error?: UndoBlockReason | 'truncate_failed' | 'restore_failed' | 'cancelled';
  forkHistoryIndex?: number;
  runId?: string;
  filesRestored?: boolean;
  safetySnapshotSha?: string;
}

/** Rewind last agent turn; Phase 1 chat-only. */
export function undoLastAgentTurn(
  chatId: string,
  options?: UndoTurnOptions,
): Promise<UndoTurnResult>;
```

**Target resolution:** among `chat.runs` with status in `completed|stopped` (and activatable or currently materialized), pick the one with greatest `forkHistoryIndex` that is still ≤ last user index and where `chat.history.length > forkHistoryIndex + 0` with at least one non-user row after the fork **or** active suffix present. Prefer the run referenced by `activeBranchByFork` at that fork when present.

### History truncate — `src/chat/history-truncate.ts`

No API change required if undo calls existing `truncateChatHistory`. Ensure prune behavior change is sufficient; undo may call `persistActiveBranchSuffix` **before** truncate.

### Fork — `src/chat/fork-from-run.ts`

Unchanged (Replay/Remake). Document that Undo must not call it.

### Loop — `src/tools/loop.ts` (Phase 2)

After `createRun` / `turnRunId` assignment (~1550–1583):

1. Resolve snapshot cwd: workspace path for the chat’s tools (`resolveChatToolWorkspaceRoot` / `getWorkspacePath` — same root tools mutate). For v1 blocked worktrees this path is unused for undo UI, but still capture if we only block *undo* not snapshotting; **recommendation:** skip snapshot capture when `getUndoEligibility` would block for board/worktree **or** when not a git repo, to avoid noise.
2. `const pre = await gitSnapshotCreate({ cwd })`; on success write `preTurnSnapshotSha`, `headShaAtTurn`, `snapshotCwd` onto the run via a small `annotateRunSnapshot(chat, runId, …)` helper in runs-store.

Near `finalizeRun` (~2581):

1. `post = await gitSnapshotCreate({ cwd })` → `postTurnSnapshotSha`.
2. Failures are non-fatal: log / `reportBackgroundError`; chat turn still completes.

### Git — server + client

**`server/git/git-ops.js`**

```js
export async function snapshotCreate({ cwd, message } = {})
export async function snapshotRestore({ cwd, sha } = {})
export async function snapshotDiff({ cwd, fromSha, toSha } = {})
```

Extend private `git(args, cwd, env?)` if needed to pass `GIT_INDEX_FILE`.

**`server/git/middleware.js`** — add keys to `OPS`.

**`src/state/git-api.ts`**

```ts
export function gitSnapshotCreate(input?: { cwd?: string; message?: string }): Promise<GitOpResult & { headSha?: string; treeSha?: string }>
export function gitSnapshotRestore(input: { cwd?: string; sha: string }): Promise<GitOpResult & { safetySha?: string }>
export function gitSnapshotDiff(input: { cwd?: string; fromSha: string; toSha: string }): Promise<GitOpResult & { files?: { status: string; path: string }[] }>
```

### Sessions — `src/state/sessions.ts`

In `ensureTurnRuns`, persist:

- `preTurnSnapshotSha`, `postTurnSnapshotSha`, `headShaAtTurn`, `snapshotCwd` (string trim / 40+ hex validation optional).

### UX

| Surface | Change |
|---------|--------|
| `src/ui/message-actions.ts` | Add **Undo turn** on assistant / assistant-tools (and optionally user row when it is the last fork). Calls `undoLastAgentTurn`. |
| `index.html` + new `src/ui/composer-undo.ts` (or wire in `composer-send.ts`) | Button in `#composerControls` trail (near tools) — **Undo last agent turn**. Disabled + tooltip when ineligible. |
| `src/ui/branch-picker.ts` | Attach when `listSelectableBranchesAtFork.length >= 2` **OR** (`history` ends at `forkHistoryIndex` and `length >= 1` activatable). Labels: “Restore branch” when no active reply. |
| `src/ui/branch-picker.ts` / activate path | Phase 2: after successful `activateBranch`, if run has `postTurnSnapshotSha`, offer/confirm file restore to post snapshot (symmetric with undo → pre). |
| Styles | `src/styles/composer-controls.css` (+ message-actions if needed); `--mn-*` tokens only. |

---

## Phase 1 — Detailed todos (message-only rewind)

### P1.1 — Branch preservation on truncate

- [x] Edit `pruneSupersededRunsAfterTruncate` to retain `outputMessages`.
- [x] Clear obsolete `outputHistory*` when cut invalidates them.
- [x] Update test in `test/chat/runs-store.test.mts`: after prune at user cut, run remains selectable via `outputMessages`; `activateBranch` restores suffix.
- [x] Add test: truncate then activateBranch round-trip (undo/redo simulation without UI).

### P1.2 — `undo-turn.ts`

- [x] Implement eligibility + `undoLastAgentTurn`.
- [x] Order: eligibility → `persistActiveBranchSuffix` → truncate inclusive → clear active branch for fork → `touchChat` / save → return result (caller renders).
- [x] Multi-turn: each call undoes the current last turn; N clicks ⇒ N turns.

### P1.3 — Branch picker single-branch redo

- [x] Change `attachBranchPicker` visibility rule.
- [x] After undo, `refreshBranchPickerAtFork(chat, forkHistoryIndex)`.
- [x] Ensure `switchBranch` still works when history length is `fork+1` (user only).

### P1.4 — UX wiring

- [x] Message ⋮ **Undo turn**.
- [x] Composer undo control on Code surface (`#composerControls`).
- [x] Guard streaming (reuse `guardStreaming` pattern from message-actions).
- [x] Guard orchestrate / board / worktree with disabled control + tooltip.
- [x] Status toasts: “Turn undone — restore it from the branch picker”.

### P1.5 — Phase 1 tests

| File | Coverage |
|------|----------|
| `test/chat/runs-store.test.mts` | prune keeps messages; activatable superseded |
| `test/chat/undo-turn.test.mts` (**new**) | eligibility blocks; undo truncates; redo via activateBranch; multi-turn |
| `test/chat/history-truncate.test.mts` | optional integration if needed |
| `test/ui/branch-picker.test.mjs` | picker appears with 1 branch when history at fork |

---

## Phase 2 — Detailed todos (file revert)

### P2.1 — Server snapshot ops

- [x] Implement create/restore/diff with temp index; Windows-safe temp paths (`fs.mkdtemp` + `index` file).
- [x] Ensure create does not mutate real index: after create, `git status` / compare index mtime or `git diff --cached` unchanged (test assertion).
- [x] Restore: safety snapshot → read-tree → clean; HEAD ref unchanged (`git rev-parse HEAD` same before/after).
- [x] Register middleware ops; extend `test/server/git-api.test.mjs`.

### P2.2 — Types + persistence

- [x] `TurnRunRecord` fields.
- [x] `ensureTurnRuns` allowlist.
- [x] Optional `annotateRunSnapshots` in runs-store.

### P2.3 — Loop hooks

- [x] Pre-turn snapshot after `createRun`.
- [x] Post-turn snapshot before/after `finalizeRun` (after history suffix known).
- [x] Skip when not a git repo / server off / blocked chat kinds (board/worktree).
- [x] Non-blocking errors.

### P2.4 — Undo + files

- [x] If `preTurnSnapshotSha` present: `snapshotDiff(pre, post|HEAD-tree)` → confirm dialog listing paths.
- [x] Divergence: compare current HEAD to `headShaAtTurn`.
- [x] Restore pre SHA; store `safetySha` (could stash on chat ephemeral or status message).
- [x] If no SHA / not git: chat rewind still succeeds; toast “Chat undone (no file snapshot)”.
- [x] Dirty user edits between post snapshot and undo: included in restore confirmation (full WT reset to pre).

### P2.5 — Redo + files

- [x] When activating a branch that has `postTurnSnapshotSha`, confirm restore to post tree (same guards).
- [x] If user declines file restore, still switch chat messages.

### P2.6 — Phase 2 tests

| File | Coverage |
|------|----------|
| `test/server/git-api.test.mjs` | snapshotCreate dangling; index untouched; restore WT; HEAD stable; clean untracked |
| `test/chat/undo-turn-files.test.mts` | mock git-api; confirm cancel; divergence path |
| `test/chat/turn-snapshots.test.mts` | capture helpers annotate run when git mock returns SHAs |

---

## UX polish

- [x] Disabled Undo: tooltip explains board/worktree/orchestrate/streaming.
- [x] Confirm copy: short path list (cap ~20 files + “and N more”); in-app `appConfirm` with Restore files / Keep files.
- [x] Status toasts via shared `UNDO_STATUS` (undo / cancel / redo restore).
- [x] Composer undo CSS matches trail chrome (`--mn-*`, focus ring, reduced motion).
- [x] No emoji in UI chrome; existing icon-svg undo glyph.
- Keyboard: optional later (not required for v1).
- Desktop / Chat app: deferred — Phase 1 acceptance is Code + ⋮ menu; same `undoLastAgentTurn` entrypoint later.

---

## Edge cases

| Case | Behavior |
|------|----------|
| Streaming in progress | Block (`truncateChatHistory` already returns `streaming`). |
| No settled agent turn | Disable Undo (`no_turn`). |
| No git repo / server off | Phase 1 OK; Phase 2 skips file restore with status. |
| Clean tree / identical pre/post | Still rewind chat; skip file confirm or show “No file changes”. |
| User edits files after turn | Restore overwrites WT to pre snapshot after confirm. |
| User commits (HEAD moves) | Divergence warning; confirm to proceed. |
| User stages files (index dirty) | Create uses temp index (safe). Restore rewrites real index to snapshot tree — call out in confirm. |
| Multi-turn undo | Repeated Undo; each time persist suffix on the turn being removed so deeper redo still works. |
| Undo then type new message | New `createRun` at same fork supersedes prior runs (existing `createRun` behavior) — branches remain in `listRunsAtFork`. |
| Undo then Replay | Existing fork path; fine. |
| Failed turns | Prefer undo only for `completed`/`stopped` with outputs; `failed` without `outputMessages` → not a target (unless board persisted outputs — still blocked by board eligibility). |
| Sub-agent only mutations | Snapshots are whole-tree; sub-agent file changes in the same WT are included. Board workers blocked. |
| Orchestrate / board / worktree | Blocked with tooltip. |
| Plan mode | Undo allowed (chat rewind); file restore same as Build when snapshots exist. |
| Concurrent two chats same repo | Snapshots are dangling commits; restore in chat A can clobber chat B’s WT — acceptable v1 risk; note in context.md. |

---

## Test plan

### Unit

- `test/chat/runs-store.test.mts` — prune/activate after truncate.
- `test/chat/undo-turn.test.mts` — eligibility matrix + rewind + multi-turn.
- `test/ui/branch-picker.test.mjs` — single-branch visibility.

### Integration

- `test/server/git-api.test.mjs` — snapshot ops against temp repo (extend existing harness).
- Optional: `test/chat/fork-from-run.test.mts` — ensure Replay still works after undo (mock `runChatTurn`).

### Manual acceptance (dev)

1. Build chat, agent edits files → Undo → messages rewind, files restored (Phase 2), branch picker restores reply (+ files).
2. Undo twice across two turns.
3. Orchestrate board chat: Undo disabled + tooltip.
4. Composer worktree chat: Undo disabled.
5. Non-git folder: chat undo works; no file restore error spam.
6. During stream: Undo disabled.

Commands: `npm test` (or scoped `tsx` tests), `npx tsc --noEmit`.

---

## `documentation/context.md` update notes

After implementation, update:

1. **Turn runs** paragraph (~L172): document Undo rewind (`src/chat/undo-turn.ts`), prune keeping `outputMessages` for redo, branch picker single-branch-at-fork behavior, and board/worktree undo block.
2. **Git /api/git** area (near MIN-198 / Source Control docs): document `snapshotCreate` / `snapshotRestore` / `snapshotDiff` — dangling commits, temp `GIT_INDEX_FILE`, restore via `read-tree --reset -u` + `clean -fd`, HEAD unchanged.
3. Cross-link MIN-409 / this plan path under plans if the doc indexes recent features.

---

## Acceptance checklist

- [x] User can rewind chat **N turns** without losing the session.
- [x] Undone turn remains redoable via **branch picker** (including the single-branch case).
- [x] Undo does **not** auto-regenerate; Replay/Remake unchanged.
- [x] `pruneSupersededRunsAfterTruncate` no longer destroys redo payloads.
- [x] Orchestrate / board / worktree-isolated: Undo **blocked** with clear message.
- [x] Phase 2: pre/post snapshots on turns in normal git workspaces; undo restores pre tree; safety snapshot taken; divergence confirm works.
- [x] Snapshot fields survive session reload (`ensureTurnRuns`).
- [x] Tests added/updated; `tsc --noEmit` clean.
- [x] `documentation/context.md` updated.

---

## Verification (VERIFY agent — 2026-07-25)

Automated verification in worktree `min409-ee66a399` / branch `henri/min-409-28agent-undo-system`.

**Critical invariants (code spot-check):**
- `pruneSupersededRunsAfterTruncate` clears stale history indices but keeps `outputMessages` (`src/state/runs-store.ts`).
- `undoLastAgentTurn` uses truncate + clearActiveBranch only — no `runChatTurn` import/call (`src/chat/undo-turn.ts`).
- Eligibility blocks orchestrate / board / worktree (`getUndoEligibility`).
- `snapshotRestore` uses safety snapshot + `read-tree --reset -u` + `clean -fd`; asserts HEAD unchanged (`server/git/git-ops.js`).
- `ensureTurnRuns` / `persistTurnSnapshotFields` allowlists SHA + cwd fields (`src/state/sessions.ts`).

**Test matrix:** 23 + 35 = 58 pass / 0 fail (suites listed in VERIFY report). `npx tsc --noEmit` exit 0.

**Residual risks (unchanged product notes):** concurrent chats on one repo (last restore wins); index rewrite on restore; Desktop/Chat composer chrome parity deferred by design.

---

## Implementation order (recommended)

1. P1.1 prune fix + tests (unblocks all redo).
2. P1.2 `undo-turn.ts` + P1.3 picker + P1.4 UX.
3. P2.1 git ops + tests (can parallelize with P1 UX).
4. P2.2–P2.5 wire fields, loop, undo/redo files.
5. UX polish + context.md + full acceptance.

---

## Risks / open questions (minimal)

1. **Redo file restore default:** On branch activate, should file restore be default-on with confirm, or opt-in? **Recommendation:** confirm dialog when `postTurnSnapshotSha` differs from current tree (same as undo).
2. **Composer worktree chats (MIN-276):** Issue blocks all `worktreeRoot` chats. Confirm product is OK blocking non-board worktree chats in v1 (safer; snapshots would otherwise need per-cwd restore).
3. **Index rewrite on restore:** `read-tree --reset -u` replaces the real index. Confirm copy should mention staged changes will be replaced.
4. **Concurrent chats on one repo:** last restore wins; document only unless product wants a lock later.

Approach (branch engine + snapshot commits + board blocked) is decided — do not re-litigate.
