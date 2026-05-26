# POLISH-005 — Click benchmark test to view run transcript

| Field | Value |
| --- | --- |
| **ID** | POLISH-005 |
| **Type** | Polish / discoverability (debugging aid) |
| **Route** | `#/benchmark` |
| **Status** | Shipped |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — requested while investigating **BUG-009** (skills), applies to all suites |
| **Related bugs** | BUG-002 (streaming), BUG-008 (modes / expected tool), BUG-009 (skills), BUG-005 (stop — partial runs may lack transcript for in-flight tests) |

## Problem

Benchmark result cards show only a short **details** snippet (max 120 characters in the UI) plus pass/fail metadata. When most tests fail—especially **skills** and **modes**—there is no way to see the actual model conversation, tool calls, or errors without re-running or adding ad-hoc logging.

Operators need a **chat-style transcript** per test (messages, tool calls, tool results, finish reason, timing) to explain failures without polluting the main chat session.

## Goals

1. **Click any finished test card** (pass, fail, skip) on the benchmark results grid and open a **read-only transcript** for that probe.
2. **Persist transcripts** on the saved run so **history compare** and `GET /api/benchmarks/:id` reloads still allow drill-down.
3. **Reuse existing transcript rendering patterns** (sub-agent drawer: system truncation, tool call/result bubbles) for consistency and less duplication.
4. **Capture at the suite layer** wherever `runOneShot` / `runToolLoop` run, without writing to `chat.history`.

## Non-goals

- Editing or continuing the benchmark conversation in the main composer.
- Re-running a single test from the transcript view (future enhancement).
- Feature 21 eval harness (`~/.minnow/evals/`) — separate product surface.
- Live streaming transcript during an in-flight test (nice-to-have; **phase 2** only if cheap).
- Fixing underlying benchmark failures (tracked as BUG-002–009).

## Current state (codebase)

| Area | Behavior today |
| --- | --- |
| **`TestResult`** (`src/benchmark/types.ts`) | `testId`, `label`, `passed`, `skipped`, `details`, timing fields — **no `messages` / transcript**. |
| **`runOneShot`** (`src/benchmark/llm-driver.ts`) | Returns `messages: [...input.messages]` only — **does not append assistant (or tool) turns** from the completion. |
| **`runToolLoop`** | Returns full `messages` array including assistant + tool rounds — **suitable for capture** once wired. |
| **Suites** | Capability / speed / skills / coding use `runOneShot`; tools / modes use `runToolLoop`. Some capability tests (**provider**, **model**) never call the LLM. |
| **UI** (`src/ui/benchmark-page.ts`) | Cards are static HTML (`renderTestCard`); **no click handlers**. `data-test-id` is present for DOM lookup. |
| **Persistence** | Whole `BenchmarkRun` JSON → `~/.minnow/benchmarks/<run-id>.json` via `POST /api/benchmarks` (`server/benchmarks/middleware.js`, **2 MB** body cap). |
| **Sub-agent drawer** (`src/ui/sub-agent-drawer.ts`) | `renderTranscript()` already renders `ApiMessage[]` read-only with tool UI — **best reuse target**. |

## Proposed UX

### Interaction

- **Trigger:** Primary click (and keyboard **Enter** / **Space** when card is focused) on `.benchmark-test-card`.
- **Surface:** Slide-over panel (mirror **sub-agent drawer**) anchored to the benchmark full-page view, not the chat shell.
  - **Header:** Test label, suite name, pass/fail/skip badge, duration, optional regression flag.
  - **Body:** Scrollable transcript (same visual language as sub-agent drawer).
  - **Footer / meta strip:** `details` string, `finishReason`, TTFT/tok/s when captured.
- **Close:** Esc, backdrop click, explicit close button — same as sub-agent drawer.
- **Empty state:** Probes with no LLM traffic (e.g. `cap-provider`) show a short explanation: *“This check did not run a model completion.”* plus any `details` / error text.

### Visual affordance

- Cards that have a transcript (or are clickable for metadata-only probes) get `cursor: pointer`, `role="button"`, `tabindex="0"`, and `aria-label` including “View transcript”.
- Optional subtle “transcript” icon on hover (CSS only) — align with **POLISH-004** copy work if both land together.

### Scenarios

| Scenario | Expected behavior |
| --- | --- |
| **Current run, after test completes** | Transcript read from in-memory `lastRun` (or live buffer updated on each `test-done`). |
| **Compare mode** | Click still opens transcript for the **current** run’s test; compare baseline does not switch unless user loads that run as primary (document in UI copy). |
| **History run loaded** | `loadRun(id)` includes per-test transcripts; cards stay clickable. |
| **Cancelled run (BUG-005)** | Completed tests have transcripts; in-flight test may be missing or marked incomplete. |
| **`npm run dev` only (localStorage)** | Same shape in persisted JSON; respect **5-run cap** in `persistence.ts`. |

## Data model

Extend **`TestResult`** (backward compatible for old JSON files):

```ts
/** Optional full conversation for this probe (API message shape). */
transcript?: ApiMessage[];

/** Optional structured extras for debugging (not shown in main chat). */
transcriptMeta?: {
  finishReason?: string;
  error?: string;
  /** Judge model output for coding suite, etc. */
  judgeRaw?: string;
};
```

- **Old runs** without `transcript`: drawer opens with empty-state + `details` only.
- **Versioning:** No formal schema version required initially; optional future `benchmarkRunVersion: 2` if we need migrations.

### Size and retention

Full runs may include **50+ tests**, large system prompts (modes/skills), and tool results.

| Mitigation | Recommendation |
| --- | --- |
| **System prompt in JSON** | Persist truncated system content (e.g. first **800** chars + length note) — same rule as sub-agent drawer display. |
| **Tool results** | Cap individual tool `content` length in persisted transcript (e.g. 8–16 KB) with `… truncated` suffix. |
| **POST body limit** | Monitor total run size against **2 MB** middleware cap; if exceeded, strip transcripts oldest-first or omit `transcript` on largest tests and set `transcriptMeta.error = 'Transcript omitted (size cap)'`. |
| **Sidecar files** | **Defer** unless sizing proves blocking: `~/.minnow/benchmarks/<run-id>/<test-id>.json` — adds API complexity. |

## Capture pipeline

### 1. Fix `runOneShot` message accumulation

Before suites can attach transcripts, **`runOneShot` must return the full message list** including the assistant reply (and tool calls if any), matching `runToolLoop` behavior:

- After `streamTurn`, push `{ role: 'assistant', content: fullText, tool_calls? }` onto `messages`.
- On non-streaming fallback path, push the resolved assistant message.

Add a focused unit test in `test/benchmark/` asserting assistant content appears in `runOneShot().messages`.

### 2. Suite helpers

Introduce a small helper in `src/benchmark/` (e.g. `test-result.ts`):

```ts
function buildTestResult(
  base: Omit<TestResult, 'transcript' | 'transcriptMeta'>,
  out?: OneShotResult | null,
  extra?: { error?: string; judgeRaw?: string },
): TestResult
```

- Map `out.messages` → `transcript` (with truncation helper).
- Map `out.finishReason`, `out.timing` into existing fields where applicable.
- On catch, set `transcriptMeta.error` and still return a `TestResult` without `transcript`.

Refactor each suite’s `result()` factory to use `buildTestResult` for LLM-backed tests only.

### 3. Non-LLM probes

For checks that only hit provider/model metadata:

- Omit `transcript`.
- Ensure `details` / `skipReason` remain the primary debug surface.

### 4. Judge / coding suite

When a second `runOneShot` acts as judge, either:

- **Append** judge messages as a labeled system/user block in `transcriptMeta.judgeRaw`, or
- Store a separate `transcriptMeta.judgeMessages` — pick one approach in implementation and document in `context.md`.

## UI architecture

### Recommended approach: benchmark transcript drawer

| Piece | Action |
| --- | --- |
| **Extract** | Move `renderTranscript` (+ tool arg parsing) from `sub-agent-drawer.ts` to `src/ui/transcript-view.ts` (or `transcript-renderer.ts`). |
| **Sub-agent drawer** | Import shared renderer (no behavior change). |
| **New module** | `src/ui/benchmark-transcript-drawer.ts` — `openBenchmarkTranscriptDrawer(test: TestResult, runMeta: { preset, model, startedAt })`. |
| **Styles** | Reuse `.sub-agent-drawer*` classes **or** duplicate with `benchmark-transcript-drawer__` BEM aliases sharing the same CSS file block — prefer **shared class prefix** `transcript-drawer__` to avoid drift. |
| **Wire-up** | In `initBenchmarkPage()`, delegate clicks on `#benchmarkSuites` for `.benchmark-test-card` → resolve `testId` → find `TestResult` in `lastRun` (or loaded history run). |

### Alternative (not recommended)

Navigate to main chat with injected read-only history — violates “no chat pollution” and confuses session state.

## Persistence and API

- **No API shape change** beyond larger JSON payloads on existing endpoints.
- **`saveRun`** / `POST /api/benchmarks` already persist the full run object — transcripts ride along once present on `TestResult`.
- **`listRuns`** summaries stay unchanged (no transcript in list).
- **Headless script** (`scripts/benchmark-headless.mjs`): optional later flag to dump transcripts to stdout for CI — out of scope unless needed for BUG-002 diagnosis.

## Testing plan

| Layer | What to add |
| --- | --- |
| **Unit** | `runOneShot` returns assistant in `messages`; `buildTestResult` truncation. |
| **Unit** | Serialize/deserialize `BenchmarkRun` with `transcript` round-trip. |
| **UI HTML** | Optional `benchmarkTranscriptDrawer` mount node in `index.html` if not created purely in JS (match sub-agent pattern). |
| **UI behavior** | Static test: `benchmark-page.ts` exports `resolveTestResultForCard(run, testId)` for unit testing lookup. |
| **Manual** | Run Full benchmark on a failing model → click failing skills/modes card → verify tool calls visible; reload page → load history → click again. |

Run: `npm run test:benchmark` and `npx tsc --noEmit`.

## Implementation phases (todos)

### Phase 1 — Data capture (backend of feature)

- [ ] Fix `runOneShot` to include assistant (and tool) messages in returned `messages`.
- [ ] Add `transcript` / `transcriptMeta` to `TestResult` in `types.ts`.
- [ ] Add `buildTestResult` + truncation helpers under `src/benchmark/`.
- [ ] Wire capability, speed, tools, skills, modes, coding suites to attach transcripts on LLM probes.
- [ ] Add unit tests for driver + result builder.

### Phase 2 — Transcript UI

- [ ] Extract shared transcript renderer from sub-agent drawer.
- [ ] Implement `benchmark-transcript-drawer.ts` (open/close/refresh).
- [ ] Add click + keyboard handlers on benchmark test cards; ARIA on cards.
- [ ] CSS: pointer/focus states; drawer layout on `#benchmarkView`.
- [ ] Empty and error states for missing transcript.

### Phase 3 — Persistence hardening

- [ ] Measure typical Full run JSON size with transcripts; adjust truncation caps.
- [ ] Handle POST 413 / “Body too large” gracefully (user-visible warning, save run without transcripts).
- [ ] Verify `loadRun` + history compare still open transcripts.

### Phase 4 — Docs and polish

- [ ] Update [`documentation/context.md`](../../context.md) Benchmark section (transcript drill-down).
- [ ] Mark POLISH-005 row in bug-hunt session doc when shipped.
- [ ] Optional: cross-link **POLISH-004** (per-test descriptions) in drawer header.

## Open questions (align before implementation)

1. **Live run:** Is transcript-on-click for the **currently running** test required in v1, or only after `test-done`?
2. **Compare mode:** Should compare baseline transcripts be openable (second drawer / toggle), or current-run only?
3. **System prompt visibility:** Show full system prompt in drawer for benchmark debugging, or always truncate like sub-agents?
4. **Export:** Copy transcript as JSON / Markdown button in drawer — in scope for v1?

## Dependencies and ordering

| Item | Relationship |
| --- | --- |
| **BUG-005** (stop) | Cancelled runs may have partial suite data; transcript feature should not assume every planned test executed. |
| **POLISH-004** | Independent; drawer header can show static test description once descriptions exist. |
| **Feature 21** | Parallel track; do not merge eval run storage with benchmark JSON. |

## Acceptance criteria

1. After a benchmark completes, clicking any test card with an LLM probe opens a drawer showing roles, tool calls, and tool results consistent with sub-agent drawer styling.
2. Saving and reloading a run from history preserves transcript drill-down for that run.
3. Old benchmark JSON files without `transcript` still render cards and open drawer with empty-state + `details`.
4. `npm run test:benchmark` and `npx tsc --noEmit` pass.
5. No writes to `chat.history` or sub-agent orchestrator state during benchmark runs.

## References

- Bug hunt: [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — POLISH-005 section
- Architecture: [`documentation/context.md`](../../context.md) — Benchmark (Bench)
- UI: `src/ui/benchmark-page.ts`, `src/styles/benchmark-page.css`
- Runner: `src/benchmark/runner.ts`, `src/benchmark/llm-driver.ts`, `src/benchmark/suites/*`
- Transcript precedent: `src/ui/sub-agent-drawer.ts`
- API: `server/benchmarks/middleware.js`, `src/benchmark/persistence.ts`


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-77](https://linear.app/minnowai/issue/MIN-77/polish-005-benchmark-test-transcript-view)
