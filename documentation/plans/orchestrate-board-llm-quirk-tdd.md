# Orchestrate board LLM-scenario TDD expansion

**Status:** Test harness landed (397 board tests). Assert **intended** recovery behaviour; failing cases are the product fix backlog — do not weaken assertions to match current bugs.

## Goal

Lock how board logic handles bad/incomplete LLM output — missing reports, fuzzy contracts, truncated tools, fixer nonsense, misclassified failures — across:

- **Headless E2E** — real `runChatTurn` + [`test/orchestrate/_board-quirk-fixtures.mts`](../../test/orchestrate/_board-quirk-fixtures.mts)
- **Stream-end / testing unit suites** — dispatcher finalizers without full tool loop
- **Live launch** — [`board-live-launch.test.mts`](../../test/orchestrate/board-live-launch.test.mts) + [`_scripted-turn-runner.mts`](../../test/orchestrate/_scripted-turn-runner.mts)

## Scenario checklist

| Family | Coverage | Primary files |
|--------|----------|---------------|
| **A** Builder `board_report` / prose contracts | Headless quirk fixtures + `task-stream-end` missing-report | `_board-quirk-fixtures.mts`, `board-headless-e2e.test.mts`, `task-stream-end.test.mts` |
| **B** Tester `VERDICT` contracts | Headless + `task-testing` | `task-testing.test.mts` |
| **C** Tool-call / stream corruption | Headless quirk fixtures | `_board-quirk-fixtures.mts` |
| **D** Merge/env-fixer LLM nonsense | `merge-fixer-llm-quirks.test.mts` | merge finalize + fixer seed context |
| **E** Failure classification crumbs | `orchestrate-failure-classify.test.mts` | MIN-285 / GAP-3 helpers |
| **F** Partial processing / interrupted turns | `task-stream-end.test.mts` | stop/pause/nudge budget |
| **G** Final integration LLM quirks | `task-testing.test.mts` + headless `finalProseNoVerdict` | final stream-end |
| **H** Context window exceeded | Headless + classify + stream-end | context SSE/post-error builders |

### A — Builder report / prose (fixtures in `quirkFixtures`)

- [x] Prose-only success without `board_report` → nudge then recover (`builderProseNoReport`)
- [x] Prose-only exhaust nudge budget → quarantine at cap (`builderProseOnlyQuarantine`) — **red**
- [x] Outcome synonyms: `green`, `ok`, `success`
- [x] Bad outcome / blank summary then recover
- [x] `env_blocked` / `fail` reports (`boardReportEnvBlocked`, `boardReportFailThenRecover`)
- [x] Empty assistant stream, duplicate `board_report` delta, sibling `task_id`
- [x] GAP-3 unverified completion nudge (`task-stream-end` unit)

### B — Tester VERDICT

- [x] Prose without marker — two nudges (`testerProseNoVerdict`)
- [x] `VERDICT:PASS`, buried marker, `board_report` instead of prose
- [x] Fail then recover (`testerFailThenRecover`)
- [ ] Conflicting markers in one message — latest pass wins — **red** (`task-testing`)
- [ ] Tester context exceeded then VERDICT recover — **red** (headless)

### C — Tool / stream corruption

- [x] Malformed / partial JSON, truncated mid-call, truncated after tool name
- [x] Nonexistent tool, forbidden `delegate_tasks`, multi-tool delta, wrong `finish_reason`
- [x] Runaway read-only / mutating tools, max-tool-turns transcript

### D — Fixer nonsense

- [x] Prose-only fixer without report → retry with context
- [x] `board_report` pass but `check_merged` false → retry
- [x] `board_report` fail → retry with failure summary

### E — Classification

- [x] ECONNREFUSED / eslint / command-not-found matrix (MIN-285)
- [x] Ambiguous mixed stall+infra / infra+code
- [ ] `Could not complete…: context length exceeded` → `code` not `stall` — **red**

### F — Interrupted turns

- [x] User stop parks (MIN-304), system stop retry cap, paused board no nudge burn
- [x] Missing-report nudge budget exhausted → quarantine

### G — Final integration

- [x] Headless final prose without VERDICT does not pass silently
- [ ] Final stream-end nudge counter — **red** (`task-testing`)

### H — Context exceeded

- [x] Stream `event:end` errors (LM Studio, OpenAI, generic) + HTTP 400 `context_length_exceeded`
- [x] Builder in-place retry on same chat (happy path headless)
- [x] Repeated context failures → quarantine at cap (`contextExceededBuildCap`)
- [ ] Tester context retry in-place — **red**
- [ ] Context failure must not use missing-report nudge path — covered in `task-stream-end` (passes when run in isolation; classify still **red**)

## Known red (fix backlog)

Run `npm run test:board` — as of this pass **5 failing tests** (intended):

| Test | Intended behaviour | Actual (bug) |
|------|-------------------|--------------|
| `board-headless-e2e` — tester context exceeded then VERDICT recover | Tester context error retries in-place; second turn `VERDICT: pass` → `complete` | Stuck `in_progress` |
| `board-headless-e2e` — builder prose-only exhausts nudge budget then quarantines | After 2 nudges + cap → `quarantined` | Stays `in_progress` (nudge/self-heal loop) |
| `orchestrate-failure-classify` — context length exceeded is transient `code` | Context-limit copy classified as `code` even when prefixed with stall marker | `stall` (stall marker wins) |
| `task-testing` — final integration prose without VERDICT nudges | `getMissingReportNudgeCountForTests(finalChat) === 1` | `0` (no final nudge path) |
| `task-testing` — conflicting VERDICT markers latest pass wins | `complete` + `testVerdict: pass` | Stays `testing` (first `fail` wins) |

## Conventions

- Name tests **scenario + intended outcome**.
- Reuse `seedBoard`, `driveLiveBoard`, `quirkFixtures`, `checkBoardLog`.
- Headless `runQuirk` supports `allowSettleTimeout` for scenarios that may not converge under current code.
- Do not skip or soften assertions to green CI — extend this backlog instead.

## Related

- [Orchestrate board testing guide](../contributor/orchestrate-board-testing.md)
- [Orchestrate boards in context.md](../context.md#orchestrate-boards)
