# Orchestrate Board — Conceptual Model Rethink

**Status:** exploration / design discussion (no code yet)
**Question being answered:** We keep fighting edge cases on the board. Usually that means the *mental model* is wrong, not that we're missing a patch. Given that **full autonomy — including automatic merge/integration resolution — is a hard requirement** (goal: fully autonomous large-task completion), are we modeling this the right way, or is there a categorically simpler model that preserves autonomy?

This is a companion to the board architecture description in [`../context.md`](../context.md) and [`../contributor/orchestrate-board-testing.md`](../contributor/orchestrate-board-testing.md), which cover the system *as built*. This doc argues about whether the *concept* is right.

---

## TL;DR

- The **board / parallel-tasks / wave** product concept is sound. Keep it.
- Three parts of the current design are already correct and should survive any rewrite: **worktree isolation**, the **serial merge queue** (one integration at a time), and **DAG dependency scheduling**.
- The complexity we fight is **inherent to one specific choice**: *parallel divergent branches reconciled by 3-way merge, with conflicts resolved by a context-free specialist agent.*
- The conceptual error is **who resolves integration problems**. We hand conflict markers to a fresh "merge-fixer" chat that wrote neither side of the conflict — the agent with the *least* context. That is the single biggest edge-case generator and it is structural, not a bug.
- Proposed model: **parallel drafting + a linear integration queue, where integration failures are resolved by re-running the *owning task agent* rebased onto current trunk ("rebase the intent, not the diff")** — reusing the task-execution machinery we already have, instead of a separate nested fixer engine.
- Supporting moves that cut edge cases regardless of the merge decision: a **mandatory structured agent→board contract** (stop parsing prose), a **single pure task reducer** (stop spreading task state across a dozen flags), and **DAG-only scheduling** (drop wave barriers as a second gating system).

---

## 1. What is actually generating the edge cases

### 1.1 Task state is a tuple pretending to be an enum

A task's real state is not `status`. It's the cross-product of:

```
status (8 values)
× autoRunning × userStopped × systemPaused × pendingAfk
× stopRetries × testAttempts × buildAttempts × fixerAttempts × selfHealRound
× which of {chatId, testChatId, fixerChatId, finalTest.chatId} is populated
```

Every new flag *multiplies* the number of reachable situations. "Edge cases" are the unenumerated cells of that implicit matrix — we discover them one crash at a time. The 7-step self-heal table is a second control-flow layer built to tame the matrix.

**Tell:** `orchestrate-board-actions.ts` is ~3,700 lines with ~90 exports, ~30 of them `*ForTests`. We reach into internals to test because behavior isn't a pure function we can drive with inputs.

### 1.2 The board reads tea leaves instead of being told what happened

The board infers outcomes from free-form text:

- Builder signals success via the **prose** string `READY FOR VERIFICATION`.
- `inferStreamOutcome` scans history for `"Maximum tool turns reached"`.
- `classifyTaskFailure` greps the transcript for `ECONNREFUSED`, `eslint`, `command not found`, with curated lists distinguishing toolchain bins from service bins to guess infra-vs-code.
- `parseTesterVerdictMarker` backward-scans for `VERDICT: pass`.

Each is a string-matching contract against non-deterministic output. **Every new phrasing the agent emits is, by construction, a new edge case.** The 233-line classifier is entropy-chasing.

### 1.3 A second orchestration engine, operating blind, nested inside the first

The auto merge-conflict **fixer** is its own LLM chat with its own lifecycle, stream-end finalizer, stall watchdog (a *different* multiplier, `FIXER_STALL_MULTIPLIER`), "must not run `git merge`" prompt rules, and restore-to-`mergePreSha` recovery. `reconcileMergingTasks` is called from **four** places because live and reload paths each need a copy.

This subsystem has the highest edge-case-per-line ratio in the codebase — **and it is required for autonomy**, so we can't delete it. The question is whether it's *modeled* right. It is not (see §3).

---

## 2. The deep cause: parallel divergent work + blind integration

Strip away the code and the architecture is: **parallel speculative execution + reconcile**. N agents run simultaneously on divergent branches; we then try to merge them into one integration branch.

Merge conflicts, integration-test failures, quarantine cascades, dependency gating — these are **inherent to running divergent work in parallel and reconciling it**. They are the *tax of parallelism*, not incidental bugs. You can't patch them away while keeping parallel divergent branches + 3-way merge.

So if autonomy requires the merge system, the lever is not "remove parallelism" and not "remove merging" — it's **change the integration model so reconciliation is something an agent is actually good at.**

---

## 3. The conceptual error: *who* resolves integration

Today, when task branches conflict, we spawn a **fresh merge-fixer chat** in the integration worktree, hand it conflict markers, and forbid it from running `git merge`. That agent has the **least context of anyone in the system** — it wrote neither side of the conflict and has to reverse-engineer intent from `<<<<<<<` markers.

This is backwards. LLM agents are strong at *"make this change to this code"* and weak at *"untangle these conflict markers you've never seen."* We picked the operation they're worst at and built a whole engine around it.

**The agent that should resolve task B's integration is the agent that did task B** — it knows *why* it made each change. It can re-apply that intent on top of the current trunk.

---

## 4. Proposed model: parallel draft → linear integration queue → rebase the intent

Keep parallelism for the slow part (writing code). Make **integration linear and self-healing through the original task agent.**

```
                 ┌─ task A (worktree, parallel) ─┐
plan → DAG ─────►├─ task B (worktree, parallel) ─┤──► integration queue (serial)
                 └─ task C (worktree, parallel) ─┘            │
                                                              ▼
                                          for each task, in dependency order:
                                            apply task result onto current trunk
                                            ├─ clean + tests pass → land (fast-forward)
                                            └─ conflict OR integration test fail
                                                  → re-run the OWNING task agent,
                                                    rebased on current trunk,
                                                    with its original spec + the failure
                                                  → re-verify → land
```

Key differences from today:

| Today | Proposed |
|-------|----------|
| 3-way merge of divergent branches into an integration branch with multiple parents | Trunk only ever **fast-forwards**; each task is **re-applied on current trunk** in order |
| Conflicts → **separate blind merge-fixer** chat on conflict markers | Conflicts → **owning task agent re-runs** on current trunk (it has full context) |
| Two failure engines (build/test self-heal **and** merge-fixer) with different stall rules | **One** engine: a task that fails to integrate is just a task that needs re-running |
| `reconcileMergingTasks` from 4 sites; `MERGE_HEAD` rules; restore-to-preSha | None of it — there is no half-finished 3-way merge state to recover |

**"Rebase the intent, not the diff."** When task B lands after task A, B is re-derived against A's result, not byte-merged. The re-run *reuses the exact task-execution + structured-verification machinery you already have*. The merge-fixer engine is **deleted and replaced by reuse**, not by new code — a net reduction while *strengthening* autonomy (the resolver now has maximal context instead of minimal).

This is the merge-queue pattern (Graphite/Mergify), adapted so the queue's conflict resolution is "the author re-runs" rather than "auto-rebase or bounce."

### Why this is more autonomous, not less

- The resolver always has the most context, so it succeeds more often unattended — the whole point of AFK mode.
- There is no nested second lifecycle to wedge, stall, or fail to recover on reload.
- Integration failures and test failures collapse into **one** retry concept with one attempt counter, not three.

### Cost / trade-offs

- Re-running a task on conflict is more expensive than a successful blind merge (full agent turn vs. a `git commit --no-edit`). For the *common clean case* there's no cost — trunk fast-forwards. Cost is paid only on actual conflict, which is exactly where the blind fixer was unreliable anyway.
- Integration is strictly serial (already true via `mergeQueueByGroupId`). Throughput is unchanged for drafting; only the land step is serialized, which it already is.
- Requires tasks to be **re-runnable from spec + current trunk**. We mostly have this (retry seeds, `buildTaskProgressSummary`, move-to-new-chat). It needs to become the *primary* path, not a recovery path.

---

## 5. Supporting moves (independent of the merge decision)

These cut edge cases no matter what we decide about integration:

**5.1 Mandatory structured agent→board contract.** Builder and tester must end by calling a tool with `{ status: done | blocked | needs_info, reasonCode, summary }`. The board acts only on that. No report ⇒ **one** event (`no_report` → retry once → escalate), not five heuristics. Deletes most of `orchestrate-failure-classify.ts` and the entire "new phrasing = new bug" class. We already have `board_report_test_result` / `board_report_build_result`; this makes them **mandatory and total** instead of one signal among several.

**5.2 Single pure task reducer.** Model each task as a *total* transition function:

```
states:  Pending → Building → Verifying → Integrating → Done
                                              ↘ NeedsHuman
events:  DepsReady | AgentDone(result) | AgentFailed(reason)
         | IntegrateOk | IntegrateFailed | Tick | UserStop | UserRetry
reduce(state, event) -> { next: state, effects: Effect[] }
```

`Effect` is data (`SpawnBuilder`, `Integrate`, `NotifyPlanner`, `Schedule`), interpreted by a thin runtime. A *total* reducer **forces enumeration of every (state,event) pair** — i.e. enumerating edge cases up front. Board flags (`autoRunning`/`userStopped`/`systemPaused`/`pendingAfk`) collapse to one question — "may the scheduler emit Spawn effects?" — plus a per-task pause. Pure ⇒ table-testable with zero chats/git, so the ~30 `*ForTests` reach-ins go away.

**5.3 DAG-only scheduling; waves become a view, not a barrier.** Today there are *two* gating systems: explicit `dependsOn` edges **and** prior-wave barriers (`isPriorWavesComplete`). Their interaction is itself an edge-case surface. With a real DAG, "waves" are just topological depth — keep them as a **visual grouping**, drop them as a **scheduling barrier**. One gating system, fewer interactions.

---

## 6. What is genuinely irreducible

Honesty check — these survive every model and should not be "simplified away":

- Dependency scheduling and a concurrency slot cap.
- Crash / reload recovery (agents are processes; processes die).
- Timeouts / stall supervision (LLM agents hang; *something* must watch).
- Serial integration (you can only safely land one change at a time).

The goal is not zero complexity. It's moving complexity from **implicit & scattered** (a dozen flags, prose parsing, a nested blind engine, 4-way reconcile) to **explicit & centralized** (one reducer, one contract, integration-by-re-run). The drain-on-microtask hack, launch-slot reservations, and dual live/boot reconcile paths are symptoms of smeared ownership and mostly evaporate when each task has one owner of truth.

---

## 7. Verdict on "are we doing this wrong?"

- **Parallel board model:** right. Keep it.
- **Worktree isolation, serial merge queue, DAG scheduling:** right. Keep them.
- **Resolving integration with a context-free specialist agent:** this is the part we're doing wrong. It's not a missing patch; it's the wrong actor for the job. Replace "blind merge-fixer" with "owning agent re-runs on current trunk."
- **Inferring outcomes from prose, and spreading task state across many flags:** also wrong, independently. Fix with a structured contract + a pure reducer.

None of these reduce autonomy. The re-run model *increases* it, because the resolver finally has the context it needs to succeed unattended.

---

## 8. Suggested migration path (non-destructive)

1. **Structured contract first** (smallest diff, biggest active-bug kill): make build/test reporting mandatory+total; stop the board parsing transcripts. Ship behind the existing engine.
2. **Pure reducer alongside** the current engine: build `reduce(state,event)->effects` mapping today's 8 statuses + self-heal table; prove it with table tests before wiring it in.
3. **Integration-by-re-run** as a new integration strategy flag, A/B against the current merge-fixer on real boards, then retire the fixer once the re-run path wins on autonomous completion rate.
4. **Collapse waves to a view** once DAG scheduling is the only gate.

Each step is independently shippable and independently reversible.

---

## Open questions

- Re-run-on-conflict assumes a task can be cleanly re-derived from `{spec, current trunk, prior failure}`. Where are the tasks that *can't* be (e.g. ones whose value depended on a now-overwritten sibling change)? Those may legitimately become `NeedsHuman` — is that acceptable for "fully autonomous", or do we need a higher-level replan step?
- Should the integration re-run be the *same* chat (with history) or a *fresh* chat seeded with a progress summary? (We have both today via continue vs. move-to-new-chat.)
- Does the planner stay in the loop for integration re-runs, or is that purely a board-engine concern with planner notified only on terminal outcomes?
