# P5-D — the unattended overnight proof

**Issue:** MIN-722 · **Status:** harness built and tested; **the three runs have not been performed.**

## What this document is

MIN-722 is the project's headline claim, stated in PRD §3: *"set-and-forget: an
unattended overnight run completes everything it can and reports once."* Every
other exit criterion in Orchestrator V2 is a component test of that one sentence.

The claim cannot be proved by writing code. It is proved by three multi-hour runs
on a real machine, with a real provider, one of them on a machine allowed to
sleep. What code *can* do is make sure that when those nights happen, they
produce a measurement rather than an anecdote — and that is what has been built.

**This is the honest split, and it should not be read as anything else:** the
plan, the instrumentation, the harness, the failure induction, the baseline
comparison and the report are done and tested. The runs are outstanding. Until
they have been performed, P5-D's acceptance criterion is **not met**, and the
project should not claim it is.

## What was built

| Piece | Where | What it is for |
|---|---|---|
| The plan | `test/fixtures/orchestrator-v2-p5d/plan.md` | 18 tasks, 5 waves, 10 files touched by more than one task. Real work of a realistic size, so the journal grows and the merge queue contends. |
| Token accounting | `server/runner/run-turn.js`, `server/orchestrator/engine.js` | Every attempt's token usage, on the journal beside its outcome. |
| Instrumentation | `server/orchestrator/p5d-instrument.js` | Journal size, fold duration, RSS, orphan census, attempt distribution, cost, report count. |
| Harness | `scripts/p5d-overnight.mjs` | Runs the board, samples it, induces failures, writes the record and the report. |
| Tests | `test/orchestrator/p5d-instrument.test.mjs`, `test/runner/run-turn.test.mjs` | 31 tests, all passing. |

## Running one night

```bash
node --import tsx scripts/p5d-overnight.mjs --board p5d-run-1 --concurrency 2 --induce break-task@1h
```

The harness creates the board from the plan, samples every 60s, writes one line
per sample to stdout, and on the run's own report writes `record.json` and
`report.md` under `documentation/plans/p5d-runs/<board>/`.

Close the UI. Let the display sleep. That is the point.

## The three runs, and why three

One run that works proves a run can work. The failure modes MIN-722 exists to
catch are the ones that only appear across runs and across hours:

1. **Run 1 — clean, concurrency 2, machine awake.** The baseline night.
2. **Run 2 — machine allowed to sleep.** A display that sleeps at 2am is the
   single most common reason an "unattended" run is not.
3. **Run 3 — induced failures.** Recovery is part of the proof, not a separate
   test.

For run 3, induce all three:

```bash
node --import tsx scripts/p5d-overnight.mjs --board p5d-run-3 \
  --induce break-task@1h --induce kill-server@2h --induce revoke-key@3h
```

`kill-server` hard-exits the harness at t+2h, leaving the board mid-run exactly
as an unexpected death would. Restart it:

```bash
node --import tsx scripts/p5d-overnight.mjs --board p5d-run-3 --resume
```

Recovering from the journal alone is the thing being proved. If the run cannot
be resumed, that is the finding — record it and stop; the rest of the night
would tell you nothing you did not already know.

## What to check in the morning

The report leads with the three questions that matter — what shipped, what did
not, what to do next — and the issue's own test of it is to hand it to someone
who did not watch the run and confirm they can answer those three. Do that. A
report only its author can read has failed even if every number in it is right.

Then read these, in this order:

- **Reports written.** Must be exactly one. Two is as much a failure as none,
  because a second report trains you to check.
- **Fold duration, start versus end.** This is the property P0-G's snapshot
  exists to guarantee, measured at real scale for the first time. Flat is
  correct. Tracking the journal means the snapshot is not doing its job, and
  the production symptom is a board that gets slower all night rather than one
  that fails.
- **Orphans.** Browsers, worktrees, generations. One orphan is a bug; one
  orphan *per attempt* is what fills a disk overnight and is invisible in any
  single-run test.
- **RSS.** A slow leak in the effector's running map looks like nothing for an
  hour and like a dead machine at 6am.
- **Attempt distribution — the tail, not the median.** One attempt that took
  forty minutes because a provider was throttling is what turns a six-hour run
  into a twelve-hour one, and it disappears into a mean.
- **Cost.** If `complete` is false, there is no cost figure — only a floor. Say
  so rather than reporting the floor as the number.

## The cost question, stated plainly

Co-Coder's finding — **+60% cost for +3.2% correctness** — is the reference
point this project set for itself, and it is the thing V2 has to be checked
against. The check needs two numbers: what the run cost, and what it got right.

The first is now recorded per attempt and summed per run, including the tokens
spent on attempts that produced nothing — which is the number that moves when
reliability slips and the one a total hides.

The second is the merge count against the plan's task count.

Neither number existed before this phase. Whatever the answer turns out to be,
it should be written into this document as a number, not a verdict.

## Against the earlier baselines

`test/orchestrator/p2g-reliability.json` (N=1) and `p3e-reliability.json` (N=2)
are the recorded baselines, and the harness compares against both.

They are 3-task boards. **Rates are comparable; raw counts are not**, and the
comparison says so in its own output rather than leaving a reader to notice.
Do not quietly compare an 18-task run's abandonment count against a 3-task
board's and call it a regression.

## Two things found while building this

Both were found by writing a realistic plan and running the acceptance criterion
rather than asserting it, and both are recorded because they are the kind of
thing that silently comes back:

1. **The browser rung fabricated assertions on non-UI plans.** A quoted
   identifier in an Accept criterion — `the barrel exports "journalSize"` — was
   compiled into "the page at `/` shows this string". On the 18-task plan that
   produced eight false assertions, every one of which would have failed against
   a perfectly working app and reported a regression that did not exist. Fixed
   in `compileAcceptCriterion`: a text or title assertion now needs an anchor —
   a route, or a UI noun. A plan with no UI now correctly reports `blocked`
   with `no-observable-criteria` and asserts nothing.

2. **The browser rung raced its own dev server**, costing one wrong verdict in
   ten. Written up in the P5-C notes in
   `orchestrator-v2-implementation.md`; the fix is `waitForPortFree()`.

Neither would have been found by a passing test suite. Both were found by
running the thing at the scale it is meant to run at, which is the entire
argument for P5-D existing.
