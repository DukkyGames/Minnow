---
name: p5d-orchestrator-hardening
overview: An 18-task, 5-wave plan against this repo, for the P5-D unattended overnight proof. Real work, real dependencies, deliberate touches overlap.
todos:
  - id: W1-A
    content: "Wave 1: Journal event catalogue"
    status: pending
  - id: W1-B
    content: "Wave 1: Attempt-outcome catalogue"
    status: pending
  - id: W1-C
    content: "Wave 1: Blocked-reason catalogue"
    status: pending
  - id: W1-D
    content: "Wave 1: Ladder rung catalogue"
    status: pending
  - id: W2-A
    content: "Wave 2: Journal size accounting"
    status: pending
  - id: W2-B
    content: "Wave 2: Fold duration accounting"
    status: pending
  - id: W2-C
    content: "Wave 2: Attempt wall-clock accounting"
    status: pending
  - id: W2-D
    content: "Wave 2: Token cost accounting"
    status: pending
  - id: W3-A
    content: "Wave 3: Orphan process census"
    status: pending
  - id: W3-B
    content: "Wave 3: Orphan worktree census"
    status: pending
  - id: W3-C
    content: "Wave 3: Resident memory census"
    status: pending
  - id: W3-D
    content: "Wave 3: Census barrel"
    status: pending
  - id: W4-A
    content: "Wave 4: Sample record format"
    status: pending
  - id: W4-B
    content: "Wave 4: Sampler loop"
    status: pending
  - id: W4-C
    content: "Wave 4: Baseline comparison"
    status: pending
  - id: W5-A
    content: "Wave 5: Run report renderer"
    status: pending
  - id: W5-B
    content: "Wave 5: Report barrel and docs"
    status: pending
  - id: W5-C
    content: "Wave 5: End-to-end sampler test"
    status: pending
isProject: true
---

# P5-D Orchestrator Hardening

**Date:** 2026-08-31
**Goal:** A genuinely substantial plan for the unattended overnight proof — 18 tasks, 5 waves, real dependencies between waves and real `touches` overlap inside them.

## Context

This plan is the *subject* of MIN-722, not its implementation. It exists so the
overnight proof runs against something the size of real work rather than a
three-task fixture: enough tasks that the journal grows, enough waves that the
scheduler has to sequence, and enough shared files that the merge queue actually
contends instead of fast-forwarding.

The work itself is real and deliberately low blast radius — catalogues,
accounting helpers, and their tests, all additive, all under
`server/orchestrator/observe/`. Nothing here deletes or rewires a live path,
because an unattended run that half-lands a risky refactor is a worse outcome
than one that proves nothing.

**Touches overlap is intentional.** Inside each wave several tasks name the same
file. That is the point: it is what makes the merge queue, the touches-conflict
check, and the overflow detector do work instead of fast-forwarding.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `server/orchestrator/observe/catalogue.js` | the four catalogues | CREATE |
| `server/orchestrator/observe/accounting.js` | size, duration, wall-clock, cost | CREATE |
| `server/orchestrator/observe/census.js` | processes, worktrees, memory | CREATE |
| `server/orchestrator/observe/sample.js` | one sample, and the loop that takes them | CREATE |
| `server/orchestrator/observe/report.js` | the human report | CREATE |
| `server/orchestrator/observe/index.js` | barrel | CREATE |
| `documentation/plans/orchestrator-v2-observability.md` | what each number means | CREATE |

## Wave Breakdown

### Wave 1 — Catalogues

#### Task W1-A: Journal event catalogue
- **Build:** In `server/orchestrator/observe/catalogue.js`, export `JOURNAL_EVENT_TYPES`, the sorted list of every key in `EVENT_SCHEMAS` from `server/orchestrator/core/events.js`, derived from that module rather than retyped.
- **Test:** A test asserts the catalogue equals the schema's own keys, so it cannot drift.
- **Accept:** the observe catalogue module exports "JOURNAL_EVENT_TYPES" and it is sorted.
- **Touches:** server/orchestrator/observe/catalogue.js, test/orchestrator/observe-catalogue.test.mjs

#### Task W1-B: Attempt-outcome catalogue
- **Build:** Add `ATTEMPT_OUTCOMES_BY_KIND` to `server/orchestrator/observe/catalogue.js`, splitting the core's attempt outcomes into terminal-success, terminal-failure, and did-not-run groups.
- **Test:** Every outcome the core defines lands in exactly one group.
- **Accept:** no outcome appears in two groups and none is missing.
- **Touches:** server/orchestrator/observe/catalogue.js, test/orchestrator/observe-catalogue.test.mjs
- **Depends on:**

#### Task W1-C: Blocked-reason catalogue
- **Build:** Add `BLOCKED_REASON_LABELS` to `server/orchestrator/observe/catalogue.js`, mapping each `BLOCKED_REASONS` entry from `server/orchestrator/browser-rung.js` to a one-line human explanation.
- **Test:** Every reason the browser rung can emit has a label.
- **Accept:** the map's keys equal BLOCKED_REASONS exactly.
- **Touches:** server/orchestrator/observe/catalogue.js, test/orchestrator/observe-catalogue.test.mjs
- **Depends on:**

#### Task W1-D: Ladder rung catalogue
- **Build:** Add `LADDER_RUNGS` to `server/orchestrator/observe/catalogue.js`, the ordered rung ids from `ALL_RUNG_IDS` with a flag for whether each is static or browser.
- **Test:** The order matches `ALL_RUNG_IDS` and `browser` is last and is the only non-static rung.
- **Accept:** LADDER_RUNGS has five entries ending in "browser".
- **Touches:** server/orchestrator/observe/catalogue.js, test/orchestrator/observe-catalogue.test.mjs
- **Depends on:**

### Wave 2 — Accounting

#### Task W2-A: Journal size accounting
- **Build:** Create `server/orchestrator/observe/accounting.js` exporting `journalSize(boardId)`, returning the journal's byte length and event count.
- **Test:** A fixture journal reports the byte length its file actually has.
- **Accept:** journalSize returns "bytes" and "events" as finite numbers.
- **Touches:** server/orchestrator/observe/accounting.js, test/orchestrator/observe-accounting.test.mjs
- **Depends on:** W1-A

#### Task W2-B: Fold duration accounting
- **Build:** Add `foldDuration(boardId)` to `server/orchestrator/observe/accounting.js`, timing one `derive()` over the board's events and returning milliseconds.
- **Test:** A larger journal takes at least as long to fold as a smaller one, measured rather than asserted by construction.
- **Accept:** foldDuration returns a finite millisecond count for a real board.
- **Touches:** server/orchestrator/observe/accounting.js, test/orchestrator/observe-accounting.test.mjs
- **Depends on:** W1-A

#### Task W2-C: Attempt wall-clock accounting
- **Build:** Add `attemptDurations(events)` to `server/orchestrator/observe/accounting.js`, returning min, median, p90 and max wall-clock milliseconds across attempts, pairing each `task.attempt.started` with its `ended`.
- **Test:** An unpaired start is excluded rather than counted as zero.
- **Accept:** attemptDurations reports a median for a journal with three finished attempts.
- **Touches:** server/orchestrator/observe/accounting.js, test/orchestrator/observe-accounting.test.mjs
- **Depends on:** W1-B

#### Task W2-D: Token cost accounting
- **Build:** Add `tokenCost(events)` to `server/orchestrator/observe/accounting.js`, summing the `usage` now carried on `task.attempt.ended` into prompt, completion and total, and reporting how many attempts had no usage at all.
- **Test:** Attempts without usage are counted as unreported, never as zero.
- **Accept:** tokenCost separates "total_tokens" from "attemptsWithoutUsage".
- **Touches:** server/orchestrator/observe/accounting.js, test/orchestrator/observe-accounting.test.mjs
- **Depends on:** W1-B

### Wave 3 — Census

#### Task W3-A: Orphan process census
- **Build:** Create `server/orchestrator/observe/census.js` exporting `browserCensus()`, reporting the browser pids the driver still tracks and whether each is alive.
- **Test:** With no browser launched the census is empty and does not throw.
- **Accept:** browserCensus returns an array on a machine with no browser.
- **Touches:** server/orchestrator/observe/census.js, test/orchestrator/observe-census.test.mjs
- **Depends on:** W1-D

#### Task W3-B: Orphan worktree census
- **Build:** Add `worktreeCensus(boardId)` to `server/orchestrator/observe/census.js`, listing the board's slot worktrees and flagging any left on disk with no live attempt.
- **Test:** A board with no worktrees reports none rather than failing to read the directory.
- **Accept:** worktreeCensus returns an array and flags a stale worktree.
- **Touches:** server/orchestrator/observe/census.js, test/orchestrator/observe-census.test.mjs
- **Depends on:** W1-D

#### Task W3-C: Resident memory census
- **Build:** Add `memoryCensus()` to `server/orchestrator/observe/census.js`, returning this process's RSS and heap used in bytes.
- **Test:** Both numbers are positive and RSS is at least heap used.
- **Accept:** memoryCensus reports a positive "rss".
- **Touches:** server/orchestrator/observe/census.js, test/orchestrator/observe-census.test.mjs
- **Depends on:**

#### Task W3-D: Census barrel
- **Build:** Create `server/orchestrator/observe/index.js` re-exporting the catalogue, accounting and census surfaces.
- **Test:** The barrel's exports match the sum of the three modules' exports.
- **Accept:** the observe barrel exports "journalSize", "memoryCensus" and "JOURNAL_EVENT_TYPES".
- **Touches:** server/orchestrator/observe/index.js, test/orchestrator/observe-census.test.mjs
- **Depends on:** W2-A, W2-B, W2-C, W2-D, W3-A, W3-B, W3-C

### Wave 4 — Sampling

#### Task W4-A: Sample record format
- **Build:** Create `server/orchestrator/observe/sample.js` exporting `takeSample(boardId)`, one record combining the accounting and census numbers with a monotonic elapsed-ms field.
- **Test:** Two samples taken in sequence have non-decreasing elapsed values.
- **Accept:** takeSample returns a record with "elapsedMs", "journal", "memory" and "browsers".
- **Touches:** server/orchestrator/observe/sample.js, test/orchestrator/observe-sample.test.mjs
- **Depends on:** W3-D

#### Task W4-B: Sampler loop
- **Build:** Add `startSampler(boardId, options)` to `server/orchestrator/observe/sample.js`, taking a sample on an interval until stopped and never letting a sampling error stop the loop.
- **Test:** A sampler whose sample function throws keeps sampling and records the error.
- **Accept:** startSampler returns a handle whose stop resolves with the samples taken.
- **Touches:** server/orchestrator/observe/sample.js, test/orchestrator/observe-sample.test.mjs
- **Depends on:** W4-A

#### Task W4-C: Baseline comparison
- **Build:** Add `compareToBaseline(samples, baseline)` to `server/orchestrator/observe/sample.js`, comparing a run's completions, retries and abandonments against the recorded P2-G and P3-E reliability files.
- **Test:** A run that matches the baseline reports no regression; one that abandons more reports it by name.
- **Accept:** compareToBaseline names the metric that moved.
- **Touches:** server/orchestrator/observe/sample.js, test/orchestrator/observe-sample.test.mjs
- **Depends on:** W4-A

### Wave 5 — Report

#### Task W5-A: Run report renderer
- **Build:** Create `server/orchestrator/observe/report.js` exporting `renderRunReport(samples, comparison)`, a Markdown report stating what shipped, what did not, and what to do next.
- **Test:** A report for a run with one abandoned task names that task and its dependents.
- **Accept:** renderRunReport output contains a "What did not ship" section.
- **Touches:** server/orchestrator/observe/report.js, test/orchestrator/observe-report.test.mjs
- **Depends on:** W4-B, W4-C

#### Task W5-B: Report barrel and docs
- **Build:** Re-export `renderRunReport` from `server/orchestrator/observe/index.js` and create `documentation/plans/orchestrator-v2-observability.md` explaining what each number means and how to read it.
- **Test:** The document names every metric the sample record carries.
- **Accept:** the observability document mentions fold duration, RSS, and token cost.
- **Touches:** server/orchestrator/observe/index.js, documentation/plans/orchestrator-v2-observability.md
- **Depends on:** W5-A

#### Task W5-C: End-to-end sampler test
- **Build:** Add a test that runs the sampler across a short synthetic board and renders a report from the samples it collected.
- **Test:** The rendered report is non-empty and mentions the board.
- **Accept:** the end-to-end sampler test passes without a browser or a model.
- **Touches:** test/orchestrator/observe-report.test.mjs
- **Depends on:** W5-A, W5-B

## Verification Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `server/orchestrator/observe/index.js` exists and re-exports all five modules
- [ ] `documentation/plans/orchestrator-v2-observability.md` names fold duration, RSS, and token cost
