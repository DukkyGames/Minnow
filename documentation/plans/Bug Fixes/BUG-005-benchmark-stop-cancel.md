---
name: BUG-005 — Benchmark Stop does not cancel run
overview: Stop on `#/benchmark` aborts the local AbortController but the runner still completes, persists, and reports success — so the UI keeps running and tests continue. Fix requires first-class cancellation through runner, suites, LLM driver, and UI.
source: documentation/bug-hunt-session-2026-05-24.md
status: verified
severity: major
linear: MIN-61
verifiedAt: 2026-05-24
related:
  - BUG-006
  - documentation/plans/benchmark-system-implementation.md
todos:
  - id: abort-helper
    content: Add shared `assertNotAborted(signal)` (or `isAbortError`) in `src/benchmark/` and use consistently across runner, suites, and llm-driver
    status: pending
  - id: runner-cancel-path
    content: Teach `runBenchmark` to detect abort, skip `saveRun`, emit `run-cancelled` (or throw `AbortError`), and avoid `run-done` on cancel
    status: pending
  - id: runner-between-tests
    content: Poll `signal.aborted` between suites and after each in-flight test progress emission; break early from suite loops via helper
    status: pending
  - id: suites-rethrow-abort
    content: Update all suite modules to rethrow abort in `catch` instead of recording a failed test and continuing
    status: pending
  - id: llm-driver-cooperative
    content: Check `signal` between tool-loop rounds and before `executeTool`; optionally cancel backend generation like chat `stopGeneration`
    status: pending
  - id: ui-stop-immediate
    content: Make `stopRun()` update UI immediately (status, progress label, `setRunning(false)` when safe) and handle `run-cancelled` / rejected `runBenchmark`
    status: pending
  - id: types-progress-event
    content: Extend `BenchmarkProgressEvent` and optionally `BenchmarkRun` with `cancelled` flag if partial runs should be retained in history
    status: pending
  - id: tests-runner-cancel
    content: Unit tests for runner abort (mock suites, assert no save, assert throw or cancel event)
    status: pending
  - id: tests-ui-stop
    content: UI/unit test that `stopRun()` aborts controller and triggers cancelled UX path
    status: pending
  - id: docs-context
    content: Update `documentation/context.md` benchmark section when fix ships; mark BUG-005 resolved in bug-hunt doc
    status: pending
isProject: false
---

# BUG-005 — Benchmark Stop does not cancel run

**Bug hunt ref:** [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — BUG-005  
**Linear:** [MIN-61](https://linear.app/minnowai/issue/MIN-61/bug-005-benchmark-stop-does-not-cancel) — priority High (2), labels `Bug`, `benchmark`  
**Architecture ref:** [`documentation/context.md`](../../context.md) — Benchmark screen (`#/benchmark`), `src/benchmark/`  
**Primary files:** [`src/benchmark/runner.ts`](../../../src/benchmark/runner.ts), [`src/ui/benchmark-page.ts`](../../../src/ui/benchmark-page.ts)

---

## Verification (2026-05-24)

**Result: CONFIRMED** — static code review; root-cause analysis below matches current implementation. No fix shipped yet.

| Check | Result |
|-------|--------|
| UI wires `AbortController` + `stopRun()` abort | Yes |
| `runBenchmark` throws or skips save on abort | **No** — resolves, `saveRun`, `run-done` |
| Suites rethrow abort | **No** — catch-and-continue |
| `runToolLoop` cooperative cancel | **No** |
| Live manual (Full + Stop during tools, ~25 min) | **Deferred** — needs `npm start` + loaded model |

---

## Summary

Clicking **Stop** during an active Quick or Full benchmark run should abort in-flight LLM requests, halt further tests, and return the page to an idle/cancelled state. Today Stop calls `AbortController.abort()` but the run often **continues until the current suite finishes**, then **saves partial results** and fires **`run-done`** as if the run succeeded — so progress keeps moving and the UI stays in the running state until natural completion.

---

## Reproduction

1. Open **Benchmark** (`#/benchmark`) with an active model loaded.
2. Start **Quick** or **Full**.
3. While tests are in progress (especially during capability, tools, or modes), click **Stop**.
4. Observe: tests keep completing, progress bar advances, status may still say “running”, run may appear in history as a normal completed run.

**Expected:** Run halts promptly; in-flight fetch/SSE torn down; no further suites/tests; UI shows cancelled; buttons return to idle.

**Actual:** Stop has no reliable effect; benchmark keeps going (see bug-hunt notes).

---

## Root cause analysis

Stop is **partially wired** — the UI creates an `AbortController` and passes `signal` into `runBenchmark` — but cancellation is not treated as a first-class outcome anywhere downstream.

### 1. UI aborts but never handles cancellation (`benchmark-page.ts`)

| What exists | Gap |
|-------------|-----|
| Module-level `abortController` | OK |
| `startRun()` passes `signal: abortController.signal` | OK |
| `stopRun()` calls `abortController?.abort()` | OK |
| `catch` in `startRun()` handles `signal.aborted` | **Never runs** — `runBenchmark` resolves normally on abort |

`stopRun()` does not call `finishLiveRunUI()`, `setRunning(false)`, or update status synchronously. The user sees no immediate feedback.

```454:456:src/ui/benchmark-page.ts
function stopRun(): void {
  abortController?.abort();
}
```

The cancelled UX path lives only in `startRun`'s `catch`, which depends on `runBenchmark` **throwing** — it does not today.

### 2. Runner treats abort like success (`runner.ts`)

Abort is checked **only**:

- Once per suite, at the top of the outer `for` loop (`if (signal.aborted) break`).
- Inside the tools suite's post-test progress loop (inconsistent with other suites).

After `break`, the runner **always**:

1. Builds a `BenchmarkRun` from partial `suiteResults`.
2. Calls `saveRun(run)` — persists a “completed” run to `~/.minnow/benchmarks/`.
3. Emits `{ type: 'run-done', run }` — UI runs `finishLiveRunUI()` and shows **Complete**.

There is no `run-cancelled` event, no thrown `AbortError`, and no `cancelled` flag on the run record.

```71:72:src/benchmark/runner.ts
  for (const suiteId of suites) {
    if (signal.aborted) break;
```

While a suite function is `await`ing (e.g. entire capability or tools battery), **no abort poll runs** — Stop waits until that suite returns.

### 3. Suites swallow abort and continue (`suites/*.ts`)

Each suite runs tests serially in a `for` loop. On error, `catch` blocks record a **failed test** and **continue** to the next test instead of rethrowing when `ctx.signal.aborted`.

Example pattern (capability, skills, tools, modes, coding):

```95:104:src/benchmark/suites/capability.ts
  } catch (err) {
    tests.push(
      result(
        'cap-stream',
        'Streaming completion',
        false,
        performance.now() - t,
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
```

Even when `postChatCompletions` abort closes the SSE stream, the suite finishes all remaining tests in the battery.

### 4. LLM driver lacks cooperative cancellation (`llm-driver.ts`)

- `streamTurn` passes `signal` to `postChatCompletions` (good for in-flight fetch).
- `runToolLoop` does **not** check `signal` between tool rounds or before `executeTool` — after the stream stops, tool execution and further rounds can still run.
- Unlike chat [`stopGeneration`](../../../src/chat/stop-generation.ts), benchmark does **not** call `cancelGeneration(generationId)` on the backend — only the local generation stream subscriber is torn down via [`fetch-chat.ts`](../../../src/providers/fetch-chat.ts). Upstream generation may continue until complete (wasted work; possible overlap with the next test).

### 5. Asymmetry with chat Stop (reference behavior)

Chat stop is the intended pattern for Minnow:

```9:21:src/chat/stop-generation.ts
export function stopGeneration(): void {
  // ...
  void cancelGeneration(generationId).catch(() => { /* best-effort */ });
  if (chatFetchAbort) chatFetchAbort.abort();
}
```

Benchmark Stop should mirror this **best-effort backend cancel + local abort** where generation IDs are available.

---

## Proposed fix

Treat benchmark cancellation like chat stop: **abort signal → tear down in-flight I/O → stop orchestration → distinct cancelled UX**. Do not persist or score partial runs as completed unless product explicitly wants “partial run in history” (see open questions).

### Layer A — Shared abort utilities

Add `src/benchmark/abort.ts` (or similar):

- `assertNotAborted(signal: AbortSignal): void` — throws `AbortError` (or `signal.reason`) when aborted.
- `isAbortError(err: unknown): boolean` — for catch/rethrow in suites and UI.

Use at:

- Top of each suite test iteration.
- After each `await` in `runToolLoop` / `streamTurn` read loop (optional early exit if stream closed due to abort).
- Runner: after each suite returns and after each `test-done` emission.

### Layer B — Runner cancellation contract

Update `runBenchmark`:

1. After the suite loop, if `signal.aborted`:
   - **Do not** call `saveRun` (default; confirm in open questions).
   - **Do not** emit `run-done`.
   - Either **throw** `AbortError` (simplest for existing UI `catch`) **or** emit `{ type: 'run-cancelled', partialRun?: BenchmarkRun }` and return `null`/rejected promise.
2. Between suites: keep `if (signal.aborted) break`.
3. After invoking a suite: if aborted mid-suite, do not start the next suite (suite should throw or return early once helper is used).

Extend [`BenchmarkProgressEvent`](../../../src/benchmark/types.ts) if using an explicit cancel event (preferred for live UI without relying solely on exceptions).

### Layer C — Suite cooperative exit

For each suite in `src/benchmark/suites/`:

```ts
} catch (err) {
  if (isAbortError(err) || ctx.signal.aborted) throw err;
  // existing failed-test push
}
```

At the start of each test iteration: `assertNotAborted(ctx.signal)`.

**Tools suite** (`tools.ts`): highest priority — serial loop over all built-in tools; longest run; overlaps with **BUG-006** hang reports.

### Layer D — LLM driver

In `runToolLoop`:

- `assertNotAborted` at start of each round and before each `executeTool`.
- Consider threading `generationId` from `createGeneration` through `postChatCompletions` (or a cancel callback) so abort also calls `cancelGeneration` — match chat stop.

### Layer E — UI immediate feedback

Update `stopRun()`:

1. `abortController?.abort()`.
2. Immediately: `setStatus('ok', 'Stopping benchmark…')`, update progress label (e.g. “Cancelling…”).
3. On `run-cancelled` or rejected `runBenchmark` with abort:
   - `finishLiveRunUI()`.
   - `setRunning(false)`.
   - Show “Run cancelled.” (existing copy in `startRun` catch).
   - Do **not** overwrite `lastRun` with partial results unless product wants that.

Optionally disable Stop after click to prevent double-abort noise.

Ensure `closeBenchmark()` still calls `stopRun()` (already does).

---

## Files to touch

| File | Change |
|------|--------|
| `src/benchmark/abort.ts` | New — abort helpers |
| `src/benchmark/runner.ts` | Cancel path, no save on abort, progress/event or throw |
| `src/benchmark/types.ts` | Optional `run-cancelled` event; optional `cancelled` on `BenchmarkRun` |
| `src/benchmark/llm-driver.ts` | Cooperative checks; optional `cancelGeneration` |
| `src/benchmark/suites/*.ts` | Per-test abort poll; rethrow abort in catch |
| `src/ui/benchmark-page.ts` | `stopRun` immediate UX; handle cancel outcome |
| `src/providers/fetch-chat.ts` | Optional — expose generation cancel on abort (if not done in driver) |
| `test/benchmark/` or `test/ui/` | New cancel tests |
| `documentation/context.md` | Note reliable Stop when shipped |
| `documentation/bug-hunt-session-2026-05-24.md` | Mark BUG-005 resolved |

---

## Test plan

### Unit — runner

- Mock suite functions; abort signal before second suite → assert:
  - First suite results present in memory only.
  - `saveRun` **not** called (mock persistence).
  - `onProgress` receives no `run-done` (or receives `run-cancelled`).
  - Promise rejects with `AbortError` **or** resolves with explicit cancelled sentinel (match implementation choice).

### Unit — suites

- Mock `runOneShot` / `runToolLoop` to hang until signal abort; assert suite throws and does not push further tests.

### Unit — UI

- Pattern similar to [`test/chat/stop-generation.test.mts`](../../../test/chat/stop-generation.test.mts): set controller, call `stopRun()`, assert `abort` fired.
- If export test hooks from `benchmark-page.ts`, assert `setRunning(false)` / progress hidden after cancel handler runs.

### Manual

1. Quick run → Stop during capability streaming → run stops within ~1–2 s; no new test cards after cancel.
2. Full run → Stop during tools suite → no further tool cards; status “Benchmark cancelled.”
3. Stop → Start new run immediately → new run proceeds cleanly (no stuck `is-running` class).
4. Close benchmark page while running → run aborts (regression for `closeBenchmark`).

---

## Acceptance criteria

- [ ] Stop halts further benchmark tests and suites within one in-flight operation boundary (not after entire tools battery).
- [ ] In-flight LLM request/stream is torn down via `AbortSignal`.
- [ ] UI leaves running state promptly; progress bar hidden; Quick/Full re-enabled.
- [ ] Cancelled run is **not** saved as a normal completed entry in benchmark history (unless product decides otherwise).
- [ ] Status shows “Benchmark cancelled.” (or equivalent).
- [ ] Automated tests cover runner + stop wiring.
- [ ] BUG-005 marked resolved in bug-hunt doc; `context.md` updated.

---

## Relationship to other bugs

| Bug | Relationship |
|-----|----------------|
| **BUG-006** (tools suite hang) | Users often hit Stop while stuck on tools; fixing BUG-005 makes Stop usable during BUG-006 scenarios but does not fix the hang itself. |
| **BUG-002–004** | Separate benchmark scoring/skipping issues; cancel fix is independent but same touch files (`runner`, suites). |

Implement **BUG-005 first** so manual verification of BUG-006 is not blocked by a non-functional Stop button.

---

## Open questions (align before implementation)

1. **Partial run persistence:** Should a cancelled run be saved to `~/.minnow/benchmarks/` with a `cancelled: true` flag for debugging, or discarded entirely?
2. **Partial UI snapshot:** Should completed test cards remain visible after cancel (current live grid), or revert to previous `lastRun` / empty state?
3. **Backend generation cancel:** Is threading `cancelGeneration` into benchmark LLM calls required for v1, or is local SSE abort sufficient if suite loops exit cooperatively?
4. **Throw vs event:** Prefer `throw AbortError` from `runBenchmark` (minimal UI change) vs explicit `run-cancelled` progress event (clearer live UX)? Recommendation: **both** — event for immediate UI, throw so `startRun` `finally` always runs cleanup.

---

## Implementation order

1. Abort helpers + runner cancel path (core contract).
2. Suite rethrow + per-iteration checks (tools first).
3. LLM driver cooperative cancel (+ optional backend cancel).
4. UI immediate Stop feedback and cancel handler.
5. Tests + docs.

No implementation in this plan — execution tracked via todos above.


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-61](https://linear.app/minnowai/issue/MIN-61/bug-005-benchmark-stop-does-not-cancel)
