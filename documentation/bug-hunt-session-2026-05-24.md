# Minnow bug hunt — 2026-05-24

Manual QA session. Bugs are logged here as reported; not yet triaged into the in-app tracker (`#/bugs`) unless noted.

**Environment**

| Field | Value |
|-------|-------|
| Date | 2026-05-24 |
| Tester | _(fill in if needed)_ |
| Build / branch | _(fill in)_ |
| Run command | _(e.g. `npm start`)_ |
| Provider / model | _(e.g. LM Studio @ localhost:1234)_ |
| OS | Windows 10 |

---

## Summary

| ID | Severity | Area | Title | Status |
|----|----------|------|-------|--------|
| BUG-001 | Major | Bugs tracker / navigation | All bugs view opens then immediately closes on first click | Open |
| BUG-002 | Major | Benchmark (`#/benchmark`) | Streaming completion test fails for every model | Open |
| BUG-003 | Major | Benchmark — speed suite | Speed tests show **0 chars** in details but still pass | Fixed (MIN-63) |
| BUG-004 | Major | Benchmark — capability suite | Multimodal capability test not run for multimodal models | Open |
| BUG-005 | Major | Benchmark (`#/benchmark`) | Stop control does not cancel an in-progress run | Fixed — [MIN-61](https://linear.app/minnowai/issue/MIN-61/bug-005-benchmark-stop-does-not-cancel) |
| BUG-006 | Major | Benchmark — tools suite | Run hangs or stops on tools suite | Verified — [MIN-67](https://linear.app/minnowai/issue/MIN-67/bug-006-benchmark-stuck-on-tools-suite) |
| BUG-007 | Major | Benchmark (`#/benchmark`) | Custom suites button does nothing | Open |
| BUG-008 | Major | Benchmark — modes suite | Mode tests fail: **expected tool missing** despite tools enabled | Open (verified — see plan + MIN-81) |
| BUG-009 | Major | Benchmark — skills suite | Most skills tests fail | Verified — [MIN-71](https://linear.app/minnowai/issue/MIN-71/bug-009-skills-benchmark-failures) |
| BUG-010 | Blocker | Browser tools (CDP) | Browser tools not working at all | Open |
| BUG-011 | Major | Tools — web fetch | Fetch web content fails (**fetch failed**) | Fixed — server HTTP fetch + client routing ([MIN-73](https://linear.app/minnowai/issue/MIN-73)) |
| BUG-015 | Major | Tools — `rag_web_content` | Web RAG tool does not work | Verified — [MIN-72](https://linear.app/minnowai/issue/MIN-72/bug-015-rag-web-content-broken) |
| BUG-016 | Major | Plan mode / streaming | Reply fails: ReadableStream JSON parse error on `close` | Open |
| BUG-017 | Minor | Top bar — model picker | Model name truncated in dropdown (ellipsis) | Fixed — [MIN-62](https://linear.app/minnowai/issue/MIN-62/bug-017-model-picker-truncates-name) |
| BUG-012 | Major | Impeccable skill | `load_impeccable_context` fails: missing `.impeccable\design.json` | Open |
| BUG-013 | Major | File editor / viewer | Syntax/code highlighting broken in editor | Open (verified 2026-05-24 — Vite prebundle; [MIN-100](https://linear.app/minnowai/issue/MIN-100/bug-013-editor-syntax-highlighting-broken)) |
| BUG-014 | Minor | Chat sidebar (collapsed rail) | **Thinking** spins whole chat icon, not just status ring | Fixed — [MIN-60](https://linear.app/minnowai/issue/MIN-60) |
| BUG-018 | Major | File panel | **Rename file** does not work | Verified — [MIN-99](https://linear.app/minnowai/issue/MIN-99/bug-018-rename-file-does-not-work) |
| BUG-019 | Major | Context / tokens UI | Context usage not live during tools + thinking | Verified — [MIN-75](https://linear.app/minnowai/issue/MIN-75) |
| BUG-020 | Major | Orchestrate / streaming | Stuck retrying; stream close **Unexpected end of JSON input** | Verified — [MIN-84](https://linear.app/minnowai/issue/MIN-84/bug-020-orchestrator-stuck-retrying-stream) |
| BUG-021 | Major | Reef widgets | Non-chart widgets (e.g. Calculator) fail with chart/toExponential error | Open |

**Counts:** 20 open · 1 fixed · 0 won't fix

---

## Bugs

### BUG-001 — All bugs view closes immediately on first open

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Bugs tracker — sidebar **All bugs** button (`#btnAllBugs`), `#/bugs` route |
| **Status** | Open |

**Summary**

First click on the bugs tracker button opens the bugs window, then it closes right away. A second click opens it and it stays open.

**Steps to reproduce**

1. Start from the main chat UI (bugs view not open).
2. Click the bugs tracker / **All bugs** button once.
3. Observe the bugs window flash open and close.
4. Click the same button again.
5. Observe the bugs window opens and remains open.

**Expected**

Bugs tracker opens on the first click and stays visible until the user navigates away or closes it.

**Actual**

First click: open → immediate close. Second click: opens normally.

**Notes**

- Reproduces on first interaction after load (or after bugs view was not shown); second click is reliable.
- Likely race or duplicate handler (route toggle + close, focus/blur, or navigation fighting `#/bugs`).

### BUG-002 — Streaming completion benchmark fails on all models

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark screen (`#/benchmark`, `#btnBenchmark`) — capability suite test **`cap-stream`** / label **Streaming completion** (`src/benchmark/suites/capability.ts`) |
| **Status** | Open |

**Summary**

The **Streaming completion** benchmark check fails for every model tested, not an isolated model/provider issue.

**Steps to reproduce**

1. Open Benchmark (`#/benchmark` or top-bar benchmark control).
2. Run benchmark against one or more models (Quick or Full preset).
3. Observe the **Streaming completion** test result.

**Expected**

Streaming completion passes when the active provider returns streamed text (non-empty `stream.text` from `runOneShot`).

**Actual**

**Streaming completion** fails across all models.

**Notes**

- Suite: capability battery via `runOneShot` (system + user “Say hello”, `maxTokens: 32`); pass criterion is `stream.text.length > 0`.
- Failure may be systemic (streaming path, parser, provider proxy, or benchmark driver) rather than per-model capability.
- Related: `documentation/plans/benchmark-system-implementation.md`, `npm run test:benchmark`.
- Likely related to **BUG-002** (empty streamed text).

### BUG-003 — Speed benchmark reports 0 chars but passes

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark — **Speed** suite (`src/benchmark/suites/speed.ts`), short runs `speed-short-1`…`3` |
| **Status** | Fixed (MIN-63, 2026-05-25) |

**Summary**

Speed benchmark cards display **0 chars** in the result details, yet the test is marked **passed**.

**Resolution (MIN-63):** `src/benchmark/suites/speed.ts` gates `passed`/`score` on non-empty completion text via `scoreSpeedCompletion` + `completion-valid.ts`; empty runs use details `empty completion (0 chars)` and do not contribute headline timing samples. Tests: `test/benchmark/speed-suite.test.mts`.

**Steps to reproduce**

1. Open Benchmark and run a suite that includes **Speed** (Quick or Full).
2. Inspect **Short run 1/2/3** (or equivalent speed rows).
3. Note details show `0 chars` with a pass/checkmark.

**Expected**

- Non-empty completion text when the run passes, **or**
- Test **fails** (or is skipped) when `out.text.length === 0`.

**Actual**

Details: **`0 chars`**. Test status: **pass**.

**Notes**

- Short runs set `details: \`${out.text.length} chars\`` and `passed: true` whenever `runOneShot` does not throw — no minimum text length check (`speed.ts` ~L40–51).
- Misleading pass state; may share root cause with **BUG-002** (stream returns empty text without error).

### BUG-004 — Multimodal capability test not run for multimodal models

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark — **Capability** suite, test **`cap-multimodal`** / **Multimodal request** (`src/benchmark/suites/capability.ts`) |
| **Status** | Open |

**Summary**

The multimodal capability test does not run even when the selected model supports multimodal / vision input.

**Steps to reproduce**

1. Select a model that is multimodal (per provider or model metadata).
2. Run Benchmark (capability suite or Full/Quick including capability).
3. Find **Multimodal request** in results.

**Expected**

Multimodal probe runs (or runs with a real image/request) and reports pass/fail based on model behavior.

**Actual**

Test is not executed for the multimodal model (skipped or absent from active run).

**Notes**

- v1 gate uses name heuristic only: `modelLooksMultimodal()` matches `vlm|vision|llava|bakllava|moondream|multimodal` in `modelId` — models without those substrings are skipped with reason **`not a VLM model`** even if actually multimodal.
- When heuristic matches, test is still **`skipped: true`** with **`VLM probe deferred`** / details **`skipped deep image probe in v1`** — no real multimodal request in either path.
- Fix likely needs provider/model **capability flags** (not ID regex) and/or implementing the deferred image probe.

**Verification (2026-05-24):** **Confirmed** via code review. Benchmark uses regex-only `modelLooksMultimodal()`; chat uses `modelCache` `type === 'vlm'`. Both branches skip — never call `runOneShot` with image content. Plan: `documentation/plans/Bug Fixes/BUG-004-multimodal-capability-test.md`. Manual bench on live VLM deferred.

### BUG-005 — Benchmark Stop does not work

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark screen (`#/benchmark`) — **Stop** control during an active run |
| **Status** | Fixed (2026-05-25) — cooperative cancel in runner, suites, LLM driver; `run-cancelled` event; no history save on abort |

**Summary**

Clicking **Stop** while a benchmark is running does not stop the run (tests continue, UI may still show running state).

**Resolution (2026-05-25):** `src/benchmark/abort.ts`; runner skips `saveRun` / `run-done` on abort; suites rethrow abort; `runToolLoop` polls signal between rounds; UI `stopRun()` shows immediate “Stopping…” / “Benchmark cancelled.” Tests: `test/benchmark/abort.test.mts`, `runner-cancel.test.mts`, `test/ui/benchmark-stop.test.mts`.

**Steps to reproduce**

1. Open Benchmark and start a run (Quick or Full).
2. While tests are in progress, click **Stop**.
3. Observe whether the run halts immediately.

**Expected**

Run aborts: in-flight requests cancelled (`AbortSignal`), progress stops, UI returns to idle/cancelled state.

**Actual**

Stop has no effect (or no reliable effect); benchmark keeps going.

**Notes**

- Likely missing or broken wiring: Stop → `AbortController` / runner cancellation in `src/benchmark/runner.ts` and `src/ui/benchmark-page.ts`.
- Related benchmark issues: **BUG-002**–**BUG-004**.

### BUG-006 — Benchmark stuck on tools suite

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark — **Tools** suite (`src/benchmark/suites/tools.ts`), Full/Quick runs that include tools |
| **Status** | Verified (code review 2026-05-24) — [MIN-67](https://linear.app/minnowai/issue/MIN-67/bug-006-benchmark-stuck-on-tools-suite) |
| **Plan** | `documentation/plans/Bug Fixes/BUG-006-benchmark-tools-suite-hang.md` |

**Summary**

Benchmark run gets **stuck on the tools suite** and does not continue (appears to hang or stop there).

**Steps to reproduce**

1. Run Benchmark with a preset that includes the **Tools** suite (e.g. **Full**).
2. Wait through earlier suites (capability, speed, etc.).
3. Observe behavior when execution reaches **Tools**.

**Expected**

Tools tests complete (pass/fail/skip) and the run proceeds to remaining suites or finishes.

**Actual**

Run **stalls on tools** — no further progress, or the whole benchmark **stops** without completing later suites.

**Notes**

- **Verified 2026-05-24:** `runner.ts` emits all Tools `test-done` only after `runToolsSuite()` finishes (~61 serial `runToolLoop` probes); UI shows no tool cards until then. `runToolLoop` runs real `executeTool` (approvals, `ask_question`, browser/CDP) with no per-test timeout; duplicate `executeTool` in `tools.ts` after loop.
- May be timeout, hung tool call, unhandled promise, or suite never resolving.
- Overlaps with **BUG-005** if user tries Stop while stuck (Stop also ineffective).
- Suite location: `src/benchmark/suites/tools.ts`, `tools-fixtures.ts`.

### BUG-007 — Custom suites button does not work

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark — **Custom suites** control (`#btnBenchmarkCustom`, panel `#benchmarkCustomSuites`) |
| **Status** | Open — **verified 2026-05-24** (see plan + Linear MIN-90) |
| **Plan** | `documentation/plans/Bug Fixes/BUG-007-custom-suites-button.md` |

**Summary**

The **Custom suites** button has no effect (does not open suite checkboxes, toggle custom selection, or start a custom-configured run as expected).

**Steps to reproduce**

1. Open Benchmark (`#/benchmark`).
2. Click **Custom suites** (or equivalent custom control in the run bar).
3. Observe UI and whether per-suite selection appears or applies to the next run.

**Expected**

- Button reveals/toggles the custom suite picker (checkboxes per suite), **and/or**
- User can select suites and run with `custom` preset (`resolveBenchmarkSuites` uses checked boxes).

**Actual**

Button click does nothing useful — panel stays hidden, broken toggle, or custom run never uses selections.

**Notes**

- Intended wiring: `btnBenchmarkCustom` toggles `benchmarkCustomSuites.hidden` (`src/ui/benchmark-page.ts`).
- Relates to **POLISH-003** (toggle button group for test selection) — may replace or overlap this control.
- Preset type `'custom'` in `src/benchmark/types.ts`.

**Verification (2026-05-24): CONFIRMED.** Click handler runs and flips `hidden`, but `.benchmark-suite-checkboxes { display: flex }` in `src/styles/benchmark-page.css` keeps `getComputedStyle(...).display === 'flex'` even when `hidden=true`, so the panel never hides and the button appears dead. Fix: add `.benchmark-suite-checkboxes[hidden] { display: none !important; }`. Plan: `documentation/plans/Bug Fixes/BUG-007-custom-suites-button.md`. Linear: [MIN-90](https://linear.app/minnowai/issue/MIN-90/bug-007-custom-suites-button-broken).

### BUG-008 — Modes suite fails with “expected tool missing” (tools enabled)

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark — **Modes** suite (`src/benchmark/suites/modes.ts`) |
| **Status** | Open (verified 2026-05-24) |
| **Plan** | [BUG-008-modes-expected-tool-missing.md](plans/Bug%20Fixes/BUG-008-modes-expected-tool-missing.md) |
| **Linear** | [MIN-81](https://linear.app/minnowai/issue/MIN-81/bug-008-modes-suite-expected-tool-missing) |

**Summary**

**Most mode tests fail** with detail **`expected tool missing`**, even when **all tools are enabled** in settings.

**Verification (2026-05-24):** Mode tool **policy** allows all probed tools. **Default** `tools.json` leaves `list_directory` / `read_file` **off**, so build/plan/orchestrate positive probes fail on fresh install. Suite passes the **full** enabled tool catalog to the API (unlike Tools suite single-tool tests) — likely overload for local models. Static test: `test/benchmark/modes-suite-probes.test.mts`.

**Steps to reproduce**

1. Confirm tools are enabled globally (Settings → tools catalog / all on).
2. Run Benchmark including the **Modes** suite (Quick includes modes; Full includes all).
3. Review per-mode test results in the Modes section.

**Expected**

Mode probes that require a tool call succeed when the model supports tools and Minnow exposes the expected tool for that mode/policy.

**Actual**

Majority of mode tests **fail**; failure message **`expected tool missing`** (model did not emit the expected tool call in the benchmark probe).

**Notes**

- Suite iterates `listModes()` and runs tool policy positive/negative probes (`loadModePromptBody`).
- Pass detail when OK: **`tool emitted`**; fail: **`expected tool missing`**.
- Likely mismatch: benchmark driver not passing tool definitions to the API, wrong tool allowlist per mode, model not calling tools in one-shot bench path, or probe expectations out of sync with shipped tools — not simply user disabling tools in UI.
- Related: **BUG-006** (tools suite hang), **BUG-002** (empty stream).

### BUG-009 — Most skills benchmark tests fail

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Benchmark — **Skills** suite (`src/benchmark/suites/skills.ts`, built-in manifest) |
| **Status** | Verified open — [MIN-71](https://linear.app/minnowai/issue/MIN-71/bug-009-skills-benchmark-failures) |

**Summary**

The majority of **skills** suite tests **fail** when running the benchmark.

**Verification (2026-05-24):** Run `2026-05-24T21-03-56-933Z.json` — **2/12** pass (`browser-automation`, `docs-update`); **10** fail with empty `details` (empty `runOneShot` text). Same-day `cap-stream` failed with empty `details` → primary suspect **BUG-002**. Plan: `documentation/plans/Bug Fixes/BUG-009-skills-benchmark-failures.md`.

**Steps to reproduce**

1. Run Benchmark with the **Skills** suite included (Full preset).
2. Open the Skills section in results.
3. Count pass vs fail across built-in skill probes.

**Expected**

Built-in slash skills respond correctly to trigger prompts; tests pass when skill body loads and model output matches suite criteria.

**Actual**

**Most skills tests fail** (specific failure details per card not yet captured in session — see **POLISH-005** for transcript drill-down).

**Notes**

- Suite iterates `builtin-manifest.json` skills and uses `fetchSkillById` + `runOneShot` with trigger prompts.
- Hard to diagnose without per-test conversation/transcript (**POLISH-005**).

### BUG-010 — Browser tools not working

| Field | Value |
|-------|-------|
| **Severity** | Blocker |
| **Area** | Browser / CDP tools (`browser_*` via `server/cdp/`, Settings → Tools → browser) |
| **Status** | Open (re-confirmed) |

**Summary**

**None of the browser tools work** — no successful browser automation or CDP-backed tool execution in normal use. Re-reported during session (all `browser_*` tools non-functional).

**Steps to reproduce**

1. Enable browser tools in settings (`browser.enabled`, Chrome with `--remote-debugging-port` or `MINNOW_BROWSER_URL` as documented).
2. In chat (Build or other mode with browser tools), invoke a browser tool (e.g. navigate, snapshot, click).
3. Observe result.

**Expected**

Browser tools connect to CDP endpoint and complete requests (navigate, snapshot, etc.) per allowlist.

**Actual**

Browser tools **completely non-functional**. Verification (2026-05-24): with `browser.enabled: true` and all `browser_*` tools enabled, **`browser_list`** returns **`Error: fetch failed`** when `http://127.0.0.1:9222` has no Chrome CDP listener (Node `fetch` to `/json/list` fails). Mock CDP unit tests still pass (`npm run test:browser` 12/12).

**Notes**

- Requires `npm start` (server-side `POST /api/tools` for 7 `browser_*` tools).
- See `documentation/context.md` — Chrome `--remote-debugging-port` (default 9222), `~/.minnow/config.json` → `browser`.
- May be environment (Chrome not running / wrong port) or app regression; capture console + tool result text when reproducing.
- **2026-05-24:** User re-confirmed — **none** of the browser tools work (not intermittent).

### BUG-011 — Fetch web content fails

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | **Fetch web content** tool (web fetch / `fetch` tool — browser or server path) |
| **Status** | Fixed — server-side `fetch_web_content` / `rag_web_content` handlers + client routing when `npm start` |

**Summary**

**Fetch web content** returns failure — reported message **`fetch failed`**.

**Verification (2026-05-24):** Code review + Node/JSDOM repro on `https://example.com` succeeds when HTTP fetch completes; browser path has no server fallback (`SERVER_TOOL_HANDLERS` lacks handler). Primary cause = in-page `fetch()` CORS failures, not HTML strip regression. See `documentation/plans/Bug Fixes/BUG-011-fetch-web-content.md`.

**Steps to reproduce**

1. Use agent or tool UI to fetch a URL (public HTTP(S) page).
2. Run **Fetch web content** (or equivalent web fetch tool).
3. Read tool result.

**Expected**

URL content retrieved and returned (or clear error with status code / CORS / network reason).

**Actual**

Tool reports **`fetch failed`** (no usable content).

**Notes**

- May be separate from **BUG-010** (browser/CDP) if fetch uses a different code path (server HTTP vs CDP).
- Capture example URL and full error payload when reproducing.

### BUG-015 — `rag_web_content` (Web RAG) does not work

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Tool **`rag_web_content`** (label **Web RAG**) — browser-routed fetch + sentence scoring (`src/tools/browser-executor.ts` → `toolRagWebContent`) |
| **Status** | Open |

**Summary**

**RAG web content** tool is **non-functional** — does not return useful ranked excerpts for a URL + query.

**Steps to reproduce**

1. Enable tool in Settings (if required).
2. Invoke **`rag_web_content`** with a URL and query (chat or agent).
3. Observe tool result.

**Expected**

Fetches page content, scores sentences by query relevance, returns RAG-style excerpt(s).

**Actual**

Tool **does not work** (error, empty result, or **`fetch failed`** — same class of failure as **BUG-011**).

**Notes**

- Distinct tool id from **`fetch_web_content`** (**BUG-011**) but may share underlying fetch path in `browser-executor.ts`.
- Likely related to **BUG-010** (browser/CDP stack broken).
- Used by Research mode / researcher work agent per prompts.

### BUG-012 — Impeccable: `load_impeccable_context` exits 1 (missing design.json)

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | Impeccable skill / `load_impeccable_context` — `src/skills/impeccable/scripts/minnow-context.mjs` |
| **Status** | Fixed — soft success with `hasDesignJson: false` ([MIN-66](https://linear.app/minnowai/issue/MIN-66), plan `documentation/plans/Bug Fixes/BUG-012-impeccable-design-json.md`) |

**Summary**

Invoking **Impeccable** fails with **`Error: load_impeccable_context exited 1`** because the workspace has no **`.impeccable\design.json`**.

**Steps to reproduce**

1. Use Impeccable skill in chat (or tool that calls `load_impeccable_context`).
2. Observe tool/skill error.

**Expected**

- Skill loads context successfully when design tokens exist, **or**
- Clear guided setup (auto-init, prompt to run `impeccable document`, or graceful skip) instead of hard exit 1.

**Actual**

```
Error: load_impeccable_context exited 1
Error: Missing .impeccable\design.json — run impeccable document or add design tokens
    at readDesignJson (minnow-context.mjs:36:11)
    at main (minnow-context.mjs:61:22)
```

(Node.js v24.13.0; path under `src/skills/impeccable/scripts/minnow-context.mjs`.)

**Notes**

- Error text instructs: run **impeccable document** or add design tokens manually.
- May be “works as designed” without prior setup — still a **bad UX / failure mode** if Minnow does not check or bootstrap `.impeccable/design.json` before calling the skill.
- Workspace: `C:/Users/dukky/Documents/Development/Minnow` (repo may lack `.impeccable/`).

### BUG-013 — Code highlighting broken in file editor

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | File panel / in-app editor (syntax highlighting for opened source files) |
| **Status** | Open |

**Summary**

**Syntax / code highlighting does not work** in the Minnow file editor (plain text or wrong colors; no language-aware highlighting).

**Steps to reproduce**

1. Open the file sidebar and open a source file (e.g. `.ts`, `.js`, `.css`, `.md`).
2. View file in the editor/viewer pane.
3. Compare to expected syntax-colored display.

**Expected**

Language-appropriate syntax highlighting (keywords, strings, comments, etc.).

**Actual**

Highlighting **broken** — missing, uniform color, or incorrect token classes.

**Notes**

- Likely file viewer / Monaco or highlight layer (`src/ui/file-*`, `file-viewer`, related CSS).
- Capture file type and whether markdown vs code paths differ when reproducing.

### BUG-014 — Collapsed sidebar: whole chat icon spins (should be ring only)

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Area** | Chat sidebar **collapsed rail** — work-agent badge / thinking state (`.chat-item-agent-badge`, `data-dot-state='thinking'`) |
| **Status** | Fixed (2026-05-25) |

**Summary**

When the sidebar is **closed/collapsed**, the **thinking** indicator spins the **entire chat icon** (e.g. work-agent abbrev **RES**, **BUI**) instead of only the **color wheel / ring** around it.

**Steps to reproduce**

1. Collapse the chat sidebar to the narrow rail.
2. Start or observe a chat in **thinking** state (streaming / `data-dot-state='thinking'`).
3. Watch the rail row for that session.

**Expected**

- Agent abbrev / icon glyph stays **upright and static**.
- Only the outer **status ring / color wheel** animates (spinner).

**Actual**

- **Whole square/icon** (border + label text) **rotates** — text appears upside down mid-spin (see session screenshot).

**Notes**

- Expanded sidebar may behave correctly (dot spinner vs badge); bug is specific to **collapsed** layout (`sidebar.css` — `.chat-sidebar.collapsed:not(.mobile-open)` + thinking badge rules).
- Related CSS: `.chat-item-dot__spinner`, `.chat-item-agent-badge` thinking styles.

**Verification (2026-05-24):** Root cause confirmed — `tool-call-spin` on `.chat-item-agent-badge` (collapsed thinking) rotates border + text; expanded dot uses child `.chat-item-dot__spinner` only. Manual live-stream repro still recommended.

**Fix (2026-05-25):** `sidebar.css` — thinking collapsed badge keeps static label; `::after` pseudo-element carries the accent ring + `tool-call-spin` (same reduced-motion rule as `.chat-item-dot__spinner`).

### BUG-016 — Plan reply fails: stream JSON parse on close

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | **Plan mode** (also may affect other modes) — browser SSE / streaming parser |
| **Status** | Open |

**Summary**

Sometimes when **making plans**, the reply aborts with a streaming/parser error instead of completing.

**Error (user-reported)**

```
Could not complete this reply: Failed to execute 'close' on 'ReadableStreamDefaultController': Unexpected non-whitespace character after JSON at position 3583 (line 71 column 2)
```

**Steps to reproduce**

1. Use **Plan** mode.
2. Send message(s) to generate a plan (intermittent).
3. Observe failure banner instead of completed assistant reply.

**Expected**

Stream completes; plan text appears; no parser error on stream close.

**Actual**

Intermittent failure; stream controller `close` throws due to **invalid/extra JSON** in SSE chunk assembly (position 3583 / line 71).

**Notes**

- **Intermittent** (“sometimes”).
- Aligns with known **llmster** / browser SSE incompatibility (`AGENTS.md` — `ReadableStreamDefaultController` JSON parsing); may surface more in Plan (longer outputs?).
- Related **BUG-002** (benchmark streaming empty/fail). Capture provider (LM Studio / llmster) and model when reproducing.

### BUG-017 — Model select truncates name (ellipsis)

| Field | Value |
|-------|-------|
| **Severity** | Minor |
| **Area** | Top bar **model picker** (`#modelSelect`, `.model-wrap` / combobox) |
| **Status** | Fixed — Linear [MIN-62](https://linear.app/minnowai/issue/MIN-62/bug-017-model-picker-truncates-name) |
| **Plan** | `documentation/plans/Bug Fixes/BUG-017-model-picker-truncation.md` |

**Summary**

The **model select dropdown** cuts off long model IDs with **`...`** instead of showing the **full text** (e.g. `Qwen3.6 35B a...` vs full `qwen/qwen3.6-35b-a3b`).

**Steps to reproduce**

1. Select a model with a long name/id.
2. View the closed combobox label in the top bar.

**Expected**

Full model name visible (wider control, wrap, tooltip on hover, or expandable menu label — product choice).

**Actual**

Label **truncated** with ellipsis; full name not readable without opening menu (if even shown there).

**Notes**

- Session screenshot: green status dot + truncated white label + caret.
- CSS likely `text-overflow: ellipsis` + fixed width on `.model-wrap` / select trigger.

**Verification (2026-05-24)**

- **Confirmed in code:** `.model-select-trigger-text` and `.model-select-option-label` use `text-overflow: ellipsis`; `.model-wrap` capped at 340px (380px ≥900px). Label pipeline (`formatModelLabel` → `syncModelSelectPicker`) puts full `optionText` in DOM; clipping is CSS-only.
- **Tooltips OK:** `title` on trigger and menu rows carries canonical id + quant + load (not a substitute for visible text per report).
- **Not a duplicate of MIN-7:** that issue fixed hover contrast; ellipsis unchanged.
- **Fix (2026-05-25):** Menu labels no longer ellipsize; menu grows to `max-content` (capped `min(90vw, 32rem)`); `.model-wrap` max-width 420px; trigger ellipsis retained; `title` tooltips unchanged.

### BUG-018 — Rename file does not work

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | File sidebar / file tree — rename action |
| **Status** | Verified (partial) — plan + Linear |
| **Plan** | [`documentation/plans/Bug Fixes/BUG-018-rename-file.md`](plans/Bug%20Fixes/BUG-018-rename-file.md) |
| **Linear** | [MIN-99](https://linear.app/minnowai/issue/MIN-99/bug-018-rename-file-does-not-work) |

**Summary**

**Renaming a file** in the file panel (context menu, inline rename, or equivalent) **does not work** — name unchanged, error, or UI no-op.

**Verification (2026-05-24)**

- **Partially confirmed:** `move_file` via `POST /api/tools` renames on disk; browser `renamePath` succeeds when `window.prompt` returns a new name.
- **Likely “no-op” causes:** prompt cancel or same basename → `renamePath` returns `false` with **no status message**; **F2** ignored while CodeMirror focused; Rename disabled when tool server offline; Windows **EBUSY** when file is locked (error only in status bar).
- **Deferred:** full manual context-menu / F2 session (~25 min).

**Steps to reproduce**

1. Open file sidebar with a workspace loaded (`npm start`).
2. Trigger **Rename** on a file (right-click or UI affordance).
3. Enter new name and confirm.
4. Check tree and disk.

**Expected**

File renamed on disk; tree and viewer reflect new path.

**Actual**

Rename **fails** or has no effect (exact error not yet captured).

**Notes**

- Implementation: `src/ui/file-tree-ops.ts` → `move_file` (not a separate rename API).
- Capture console/network on manual repro; check status strip for `Error: EBUSY` on Windows.

### BUG-019 — Context usage not real-time (tools + thinking)

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | **Context usage** indicator / token budget UI (composer or status) |
| **Status** | Verified (2026-05-24 static review) — Linear [MIN-75](https://linear.app/minnowai/issue/MIN-75), plan `documentation/plans/Bug Fixes/BUG-019-context-usage-realtime.md` |

**Summary**

**Context usage** should update **in real time** as the turn progresses (tool calls, tool results, **thinking** / reasoning tokens) — not only **after the full assistant message is received**.

**Steps to reproduce**

1. Start a chat turn that uses tools and/or extended thinking.
2. Watch context usage meter/label during the turn.
3. Compare to value after message completes.

**Expected**

Usage climbs live as context grows: user message, thinking stream, each tool round-trip, partial assistant content.

**Actual**

Context usage is calculated/updated **only after the message is received** (end of turn) — stale or zero during active tool/thinking phases.

**Notes**

- Feature #03 context budgets may exist server-side; UI feedback lag is the reported issue.
- Affects user awareness before hitting context limits mid-turn.

### BUG-020 — Orchestrator stuck retrying: stream JSON EOF on close

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | **Orchestrate** mode — orchestrator turn streaming + retry loop |
| **Status** | Open |

**Summary**

Orchestrator can **get stuck retrying** and never complete the reply. User sees streaming failure when the stream closes.

**Error (user-reported)**

```
Could not complete this reply: Failed to execute 'close' on 'ReadableStreamDefaultController': Unexpected end of JSON input
```

**Steps to reproduce**

1. Run **Orchestrate** mode with board + sub-agents (active orchestration).
2. Let orchestrator run until failure (may involve retries).
3. Observe stuck retry behavior and error banner.

**Expected**

Turn completes or fails cleanly with recoverable state; retries succeed or stop with clear limit.

**Actual**

**Stuck in retry loop**; stream `close` throws **Unexpected end of JSON input** (truncated/malformed SSE JSON vs **BUG-016** partial JSON).

**Notes**

- Related **BUG-016** (Plan mode, “non-whitespace after JSON at position 3583”) — same `ReadableStreamDefaultController` class, different parse failure.
- Related **POLISH-022** (status visibility). Known llmster/browser SSE issues per `AGENTS.md`.
- Capture whether supervisor stall/restart triggers the loop.

### BUG-021 — Reef widget error on non-chart widgets (Calculator)

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Area** | **Reef** widgets — `reef-widget` mount / validation (`widget-fence-lint.ts`, `widget-prelude.ts`, `widget-error-ui.ts`) |
| **Status** | Open |

**Summary**

Widgets that **do not use charts** (e.g. **Calculator**) show **Widget could not be displayed** with a **misleading chart-axis error** about `toExponential`.

**Error UI (user-reported)**

- Title: **Widget could not be displayed**
- Message: **Do not use toExponential on axis ticks (collapses Y-axis width); use toFixed instead.**
- Hint: Ask the assistant to fix the reef-widget fence…

**Steps to reproduce**

1. Open or generate a **Calculator** reef widget (no Recharts).
2. Widget fails validation / mount.
3. Error cites `toExponential` / axis ticks despite no chart.

**Expected**

Calculator (and other non-chart templates) render without chart-specific lint/runtime checks.

**Actual**

False positive or over-broad validation — chart rules applied to non-chart widgets.

**Notes**

- Static lint: `widget-fence-lint.ts` flags `\btoExponential\s*\(` in fence body.
- Runtime: `widget-prelude.ts` `probeChartLayout()` scans axis tick text for scientific notation (`/e[+-]?\d+/i`) — may false-positive on non-chart text.
- Related **POLISH-020** (Reef merged into General/Research). Templates: `src/chat/reef/widgets/calculator*.md`.

---

## Polish / UX (not bugs)

| ID | Area | Request | Status |
|----|------|---------|--------|
| POLISH-001 | Chat sidebar — `.chat-item-row` | Squish session rows: less row padding, tighter list gap, smaller meta spacing (was ~86px tall) | **Requested** |
| POLISH-002 | Benchmark (`#/benchmark`) | Fun in-run animation: fading text for current test + model info | **Requested** |
| POLISH-003 | Benchmark (`#/benchmark`) | Test/suite selection as toggle button group (not current control) | **Requested** |
| POLISH-004 | Benchmark (`#/benchmark`) | Per-test descriptions: what each test does and what it validates | **Requested** |
| POLISH-005 | Benchmark (`#/benchmark`) | Click any test to open/view the transcript (chat) for that run | **Requested** |
| POLISH-006 | File editor | AI-powered code autocomplete in the editor | **Requested** |
| POLISH-007 | File editor | Edit `.md` files with basic text editor tooling | **Requested** |
| POLISH-008 | File editor + chat | Right-click selection → **Add to chat** | **Requested** |
| POLISH-009 | File tree + chat | Right-click file in tree → **Add to chat** | **Requested** |
| POLISH-010 | Bug tracker (`#/bugs`) | Title and description on separate lines; more title space | **Done** (verified 2026-05-24) |
| POLISH-011 | App shell | In-app **browser view** (embedded browser; [architecture plan](plans/Bug%20Fixes/POLISH-011-in-app-browser-view.md)) | **Planned** |
| POLISH-012 | Bug tracker | Categories + file/code links on bugs | **Requested** |
| POLISH-013 | Editor + file tree | Right-click **Report bug** (pre-fill from selection/file) | **Requested** |
| POLISH-014 | Bug view layout | File sidebar + viewer visible while on `#/bugs` | Verified — [MIN-93](https://linear.app/minnowai/issue/MIN-93/polish-014-file-panel-on-bug-view) |
| POLISH-015 | Bug view layout | Keep main **top bar** visible on bug tracker | **Requested** |
| POLISH-016 | Onboarding / shell | First launch → **workspace select** home (Cursor-style) | **Requested** |
| POLISH-017 | Chat sidebar | **Pin chats** to top of session list | **Requested** |
| POLISH-018 | Plan mode | Intent picker: preset buttons + preprompt + user input | **Planned** |
| POLISH-019 | Composer modes | Add **General** / **Chat** mode (lightweight conversation) | **Requested** |
| POLISH-020 | Composer modes | **Merge Reef** into General + Research (remove Reef as own mode) | **Requested** |
| POLISH-021 | Agent tools | **`grep` / search in files** tool for agents | **Requested** |
| POLISH-022 | Orchestrate mode | Richer orchestrator status (per worker/sub-agent step) | **Requested** |
| POLISH-023 | Bug tracker | Bug **detail view** + attachments (images, files, etc.) | **Requested** |

### POLISH-002 — Benchmark run animation (fading status copy)

**Summary**

Replace or augment the current benchmark progress UI with a more engaging animation while tests run.

**Desired behavior**

- Text **fades in and out** during the run.
- Show **what is currently being tested** (suite + test label, e.g. “Streaming completion”, “Short run 2”).
- Show **context from the active model** (e.g. provider + `modelId`, or short model metadata when available).

**Area**

- Benchmark screen: `#/benchmark`, `src/ui/benchmark-page.ts`, `src/styles/benchmark-page.css`
- Hook into existing `onProgress` / live progress from `src/benchmark/runner.ts`

**Notes**

- Enhancement only — not blocking benchmark correctness (see **BUG-002**–**BUG-004**).
- Should remain readable and not obscure pass/fail results when the run finishes.

### POLISH-003 — Benchmark test selection as toggle buttons

**Summary**

Change how users pick which benchmark tests/suites to run: use a **group of toggleable buttons** instead of the current selection UI (e.g. preset dropdown or single Quick/Full control).

**Desired behavior**

- One or more **toggle buttons** per suite and/or per test (or per preset group), visually grouped.
- User can turn suites/tests on or off before starting a run.
- Clear selected vs unselected state (active toggle styling).

**Area**

- Benchmark screen: `#/benchmark`, `src/ui/benchmark-page.ts`, `src/styles/benchmark-page.css`
- May interact with presets (Quick / Full) — define whether presets set toggles or coexist with manual selection.

**Notes**

- UX improvement only; unrelated to **BUG-002**–**BUG-004** correctness issues.

### POLISH-004 — Benchmark test descriptions

**Summary**

Add clear **descriptions** for each benchmark test so users understand **what it does** and **what it is testing** (not just the short label, e.g. “Streaming completion”).

**Desired behavior**

- Each test card (or suite section) shows helper copy: purpose, method (e.g. prompt type, streaming vs non-stream), and pass criteria in plain language.
- Optional: expand/collapse or tooltip for long text; visible before/during/after run.
- Cover all suites: capability, speed, tools, skills, modes, coding.

**Area**

- UI: `src/ui/benchmark-page.ts`, `src/styles/benchmark-page.css`
- Copy can live beside suite definitions (`src/benchmark/suites/*.ts`) or a dedicated manifest (e.g. `test-descriptions.ts`).

**Notes**

- Documentation / discoverability improvement; complements **POLISH-002** (live status text) and **POLISH-003** (toggle selection).

### POLISH-005 — Click benchmark test to view run chat / transcript

**Summary**

Allow clicking **any benchmark test row/card** to open a **chat-style view** of what happened during that test (messages, tool calls, errors, raw model output).

**Desired behavior**

- Click test in results (pass, fail, or skip) → navigate or drawer/modal with full transcript for that probe.
- Enough context to debug failures (e.g. **BUG-009** skills, **BUG-008** modes, **BUG-002** streaming).
- Persist transcript on the benchmark run record if needed (`~/.minnow/benchmarks/<run-id>.json`).

**Area**

- `src/ui/benchmark-page.ts`, benchmark result cards (`benchmark-test-grid`)
- Runner: capture messages per test in `src/benchmark/runner.ts` / `llm-driver.ts`

**Notes**

- Requested while investigating **BUG-009**; applies to all suites.

### POLISH-006 — AI code autocomplete in file editor

**Summary**

Add **AI-assisted autocomplete** (inline completions / ghost text) in the Minnow file editor, similar to Copilot-style suggestions.

**Desired behavior**

- As user types in an open file, model suggests next tokens/lines (context: file content, language, workspace).
- Accept/dismiss keybindings (e.g. Tab accept, Esc dismiss).
- Respects active provider/model and privacy (local LLM when configured).
- Optional toggle in settings; does not block normal editor when off.

**Area**

- File viewer / editor (`src/ui/file-*`, file panel)
- May need completion API hook on provider chat path or dedicated lightweight completion endpoint

**Notes**

- Feature request (not a bug). Related editor quality: **BUG-013** (syntax highlighting).
- Out of scope for current bug-hunt fixes unless prioritized separately.

### POLISH-007 — Editable Markdown in file editor

**Summary**

Support **editing `.md` files** in the file panel editor with **basic text editor tools** (not view-only preview).

**Desired behavior**

- Open `.md` in an editable buffer (not preview-only).
- Basic editing affordances: typing, select/copy/paste, undo/redo, find (optional), save back to disk.
- Optional split or toggle: edit vs rendered preview; editing is the priority for this request.

**Area**

- File viewer (`src/ui/file-*`, markdown preview path vs code editor path)
- Save via existing file write tool/API if present

**Notes**

- Feature request. May overlap markdown **preview** path today; user wants writable markdown with standard editor UX.
- Related: **BUG-013** (highlighting), **POLISH-006** (AI autocomplete).

### POLISH-008 — Select code → right-click Add to chat

**Summary**

In the file editor, user can **select code/text**, **right-click**, and choose **Add to chat** (or equivalent) to insert the selection into the composer as context.

**Desired behavior**

- Context menu on selection in file viewer/editor.
- **Add to chat** attaches snippet with file path + line range (if available) for agent context.
- Works for code and markdown/plain text selections.

**Area**

- File panel editor + composer (`src/ui/file-*`, chat composer / attachments)

**Notes**

- Common IDE pattern (Cursor/VS Code “Add to Chat”). Complements **POLISH-007** (editable md).

### POLISH-009 — File tree context menu: Add to chat

**Summary**

**Right-click a file** in the file sidebar/tree and choose **Add to chat** to attach that file (or its path/content) to the composer.

**Desired behavior**

- Context menu on file tree items (files; define behavior for folders if any).
- **Add to chat** adds file as attachment/context (same or similar to composer paperclip / `@` file reference).
- Respect workspace scope and large-file limits.

**Area**

- File tree UI (`src/ui/file-tree.ts`, file panel context menus)
- Chat composer attachments

**Notes**

- Distinct from **POLISH-008** (selection inside open editor vs tree node).
- May reuse existing attachment pipeline for images/text/code.

### POLISH-010 — Bug tracker: title + description layout

**Summary**

Bug tracker cards/rows need **more room for titles** and a clearer layout: **title** and **description** on **two separate lines** (not cramped on one line or truncated together).

**Desired behavior**

- **Line 1:** Bug title (primary, more horizontal space / less truncation).
- **Line 2:** Description (secondary text, full width below title).
- Kanban cards and global bugs list (`#/bugs`, `src/ui/bug-board.ts`) both benefit.

**Area**

- Bug tracker UI: `#/bugs`, `#globalBugsList`, bug board components + CSS

**Notes**

- UX/layout only. Related navigation bug: **BUG-001** (first open flash).

### POLISH-011 — In-app browser view

**Summary**

Add an **embedded browser view** inside Minnow so users can see and interact with pages without leaving the app (today browser tools rely on external Chrome CDP — **BUG-010**).

**Architecture plan:** [`documentation/plans/Bug Fixes/POLISH-011-in-app-browser-view.md`](plans/Bug%20Fixes/POLISH-011-in-app-browser-view.md) — **recommended v1:** CDP **screencast mirror** of the agent’s Chrome target (Option A); optional v2 server-managed Chrome (Option D). Rejects iframe/proxy and Electron-for-browsing for v1.

**Desired behavior (high level)**

- Dedicated browser panel or tab in the UI (navigate, view page, link to agent tools).
- Agent/browser tools can target the in-app view where appropriate.

**Area**

- New UI surface + server/CDP integration per plan doc.

**Notes**

- Large feature — implementation after plan approval and **BUG-010** fix.
- Complements fixing **BUG-010** / **BUG-011** / **BUG-015** (tools) but distinct (visible browser chrome in app).

### POLISH-012 — Bug tracker: categories + linked files/code

**Summary**

Extend the bug tracker with **categories** (taxonomy/labels) and **links to files or code** attached to each bug.

**Desired behavior**

- **Categories:** assign/filter bugs by category (e.g. UI, Tools, Benchmark — or user-defined).
- **Links:** each bug can reference one or more **file paths**, optional **line range**, and/or **code snippets** captured from the editor.
- Visible on bug cards and detail view (`#/bugs`, kanban).

**Area**

- `src/state/bug-board-store.ts`, `src/ui/bug-board.ts`, `~/.minnow/bugs/state.json` schema
- Tools: may extend `bug_add` / `bug_update` (`bug_*` trio)

**Notes**

- Pairs with **POLISH-010** (title/description layout). MIN-16 global bugs plan may need v2 scope update.

### POLISH-013 — Context menu: Report bug

**Summary**

**Right-click** in the **file tree** or **editor** (selection or file) → **Report bug** opens bug creation with context pre-filled.

**Desired behavior**

- Menu item **Report bug** on file tree nodes and editor selection.
- Pre-fill: title suggestion, description, **linked file path**, line range, selected code snippet (feeds **POLISH-012**).
- Optional: default category from context.

**Area**

- File tree + file editor context menus (`src/ui/file-tree.ts`, file viewer)
- Bug add flow / `#/bugs` or inline modal (`bug_add` tool or UI form)

**Notes**

- Complements **POLISH-009** (Add to chat) — parallel “Report bug” path for issue tracking.
- Distinct from agent-only `bug_add` in All bugs screen.

### POLISH-014 — File panel visible in bug view

**Summary**

When viewing the **bug tracker** (`#/bugs` / All bugs), user should still see the **file sidebar** and **file viewer** (not full-screen bugs-only layout).

**Desired behavior**

- Bug board and file panel coexist (split layout or resizable panes).
- Can open linked files (**POLISH-012**) or workspace context while triaging bugs.
- Define behavior on narrow/mobile (stack vs hide file panel).

**Area**

- App layout / routing: `#/bugs` vs `#fileSidebar`, `applyFileLayout` or equivalent (`src/ui/file-layout.ts`, main shell)

**Notes**

- Layout/UX request. Related **BUG-001** (bugs view open/close). Complements **POLISH-012** / **POLISH-013** (file-linked bugs).

**Status:** Verified (open) 2026-05-24 — `openGlobalBugs()` hides `#appBody` (file panel inside); plan Option 1. Linear [MIN-93](https://linear.app/minnowai/issue/MIN-93/polish-014-file-panel-on-bug-view). Plan: `documentation/plans/Bug Fixes/POLISH-014-bug-view-file-panel.md`.

### POLISH-015 — Keep top bar in bug tracker

**Summary**

The **main top bar** (brand, model picker, workspace, benchmark, settings, etc.) should remain **visible** when the user is on the bug tracker view — not hidden or replaced by a bugs-only chrome.

**Desired behavior**

- `#/bugs` uses same `header.topbar` as chat/main shell.
- Model/workspace actions still available while triaging bugs.

**Area**

- Bug view routing / layout (`src/ui/bug-board.ts`, global bugs page, shell visibility toggles)

**Notes**

- Pairs with **POLISH-014** (file panel + bugs layout). Related **BUG-001**.

### POLISH-016 — Workspace select screen on first open (Cursor-style)

**Summary**

On **first open** (or when no workspace is active), Minnow should land on a **workspace select / welcome** screen similar to **Cursor’s** empty-window home — not jump straight into chat with no context.

**Reference (session screenshot — Cursor)**

- Header: product logo + name; secondary links (e.g. plan tier, Settings).
- **Primary actions (tiles):** Open project · Clone repo · Connect via SSH (Minnow may adapt: Open folder, Recent workspace, New window, etc.).
- **Recent projects:** list with **name** (left) + **path** (right), “View all (N)”, support workspace files (e.g. `*.code-workspace` / Minnow equivalent).

**Desired behavior (Minnow)**

- Default route or boot state when `getWorkspacePath()` unset / cold start.
- Picking a recent or opened folder sets workspace and enters main app (chat + sidebars).
- Persist recents in `~/.minnow` (or sessions meta).

**Area**

- New view/route (e.g. `#/welcome` or `#/workspaces`), shell routing in `main.ts` / workspace menu
- May overlap existing workspace picker (`src/ui/workspace-menu.ts`) — unify or replace

**Notes**

- Large UX addition; reference image saved in bug-hunt session assets.
- Distinct from **POLISH-011** (in-app browser).

### POLISH-017 — Pin chats to top of sidebar

**Summary**

Allow users to **pin** important chats so they stay at the **top** of the chat list (per workspace), above unpinned sessions sorted by recency.

**Desired behavior**

- Pin/unpin via context menu or icon on `.chat-item-row` (alongside rename/delete).
- Pinned section at top of `#chatList` (optional “Pinned” header).
- Persist `pinned` on chat in session state (`sessions/state.json` or chat model).

**Area**

- `src/ui/sidebar.ts`, chat list sort order, session persistence

**Notes**

- Complements **POLISH-001** (denser row layout). Workspace-scoped like other chats (B2).

### POLISH-018 — Plan mode: intent picker on open

**Summary**

When user switches to **Plan** mode (or opens a Plan chat), show a **dedicated display** asking what they want to do — not an empty composer only.

**Desired behavior**

- **Preset buttons** (examples from session):
  - **New feature**
  - **UI designer** (ui-designer / Impeccable-adjacent flow)
  - **Code review**
  - **Write tests**
  - **Other** — free-text field for custom goal
- Each preset:
  1. Applies a **preprompt** (mode/skill-specific system or first user scaffold).
  2. Prompts for **user input** (short description of scope).
  3. Submits combined message into Plan thread.
- **Other:** user types their own message without a fixed preprompt template.

**Area**

- Plan mode UX (`modes/plan.*`, composer, empty-state or modal in chat area)
- May map to existing skills (`code-review`, `write-tests`, `impeccable` / ui-designer) or plan prompts

**Notes**

- Onboarding for Plan mode; reduces blank-slate friction.
- Define whether picker shows once per chat or every time mode is selected.

### POLISH-019 — General / Chat mode

**Summary**

Add a **General** or **Chat** composer mode for everyday conversation — less prescriptive than Build/Plan/Orchestrate/Research/Reef.

**Desired behavior**

- New mode in mode picker (name TBD: **General** or **Chat**).
- Lighter system prompt: Q&A, explanations, brainstorming — not full build/plan/orchestrate tool policies unless user opts in.
- Default or easy fallback when user does not need a specialized workflow.

**Area**

- `src/chat/modes/` registry, `modes/*.md` prompts, composer mode UI
- Tool allowlist: likely narrower than Build (product decision)

**Notes**

- Today five modes: Build, Plan, Orchestrate, Research, Reef (`documentation/context.md`). This would be a sixth or rename/clarify Build vs “chat”.
- Distinct from **POLISH-018** (Plan-only intent picker).

### POLISH-020 — Integrate Reef into General + Research (drop Reef mode)

**Summary**

**Reef** (inline `reef-widget` artifacts) should **not** be a standalone composer mode. Capabilities move into **General/Chat** and **Research** modes.

**Desired behavior**

- Remove **Reef** from mode picker (five modes → four + General per **POLISH-019**, or re-count after merge).
- **General/Chat:** Reef widgets when appropriate for interactive UI in conversation.
- **Research:** Reef where useful for research deliverables (charts, tables, etc.).
- Migrate `modes/reef.*.md` prompts/widgets into those modes; legacy `reef` chats/modeId handling on load.

**Area**

- Mode registry, composer UI, `modes/reef.*`, Reef widget pipeline (`src/chat/reef/`)

**Notes**

- Product/architecture change — affects docs claiming five primary modes.
- Widget templates (`reef-widget` fences, 15 templates) stay; mode shell goes away.

### POLISH-021 — Agent tool: grep / search in files

**Summary**

Agents need a **`grep`** (or equivalent) tool to **search file contents** by pattern in the workspace — not only `read_file` / directory listing.

**Desired behavior**

- Tool accepts pattern (regex or literal), path/glob, case sensitivity, context lines (product TBD).
- Returns matching paths, line numbers, and snippet lines (ripgrep-style).
- `serverRequired: true`; workspace-scoped; respects ignore rules (.gitignore).
- Available in Build and other modes per tool policy; enable in Settings catalog.

**Area**

- `src/tools/definitions.ts`, server handler (`server.js` / tools), possibly reuse ripgrep if present in environment

**Notes**

- No `grep` tool id in definitions today (session check). Complements codebase search / LSP tools if any.
- Related **BUG-008** (mode tool probes) if grep becomes required for mode tests.

### POLISH-022 — Orchestrator status: more granular detail

**Summary**

**Orchestrate** mode status should show **more detailed, step-level messages** — not only high-level “orchestrating” state.

**Example (user request)**

- `Generating sub-agent prompt for W1-A`
- (Extend to: spawning worker, worker running, tool use, handoff, completed/failed per worker id)

**Desired behavior**

- Live status line / board / activity UI updates as orchestrator progresses.
- Include **worker or sub-agent id** (e.g. `W1-A`) and **action** (generating prompt, executing, waiting, etc.).
- Surface via existing `report_orchestrator_status` tool and/or Orchestrate UI (board, agent activity).

**Area**

- Orchestrate mode UI, `src/tools/board-tools.ts`, orchestrator prompts, `#btnAgentActivity` / board views

**Notes**

- Observability / UX; helps debug orchestration without reading raw tool logs.

### POLISH-023 — Bug detail view + rich attachments

**Summary**

Bug tracker needs a **full detail view** per bug and support for **attachments** (images, files, and related artifacts).

**Desired behavior**

- **Click a bug** (kanban card or global list row) → **detail panel or page** with full title, description, category, status, workspace, linked code/files (**POLISH-012**), investigation chat link, history.
- **Attachments:** upload or link **images** (screenshots), **files**, and optionally URLs; show thumbnails/previews in detail view.
- Add/remove attachments when creating or editing a bug (**POLISH-013** Report bug may attach context automatically).

**Area**

- `src/ui/bug-board.ts`, `#/bugs`, `bug-board-store` / `~/.minnow/bugs/state.json` schema extension
- Storage: attachment paths or blobs under `~/.minnow/bugs/` (TBD)

**Notes**

- Extends **POLISH-010** (title + description layout), **POLISH-012** / **POLISH-013** / **POLISH-014**.
- Distinct from **BUG-001** (first-open flash).

---

## Notes

- **Note-taker only:** log bugs and polish items here; do not edit app/source files during this session.
- Related product docs: [`plans/min-16-bug-tracker.md`](plans/min-16-bug-tracker.md), [`plans/min-16-global-bugs.md`](plans/min-16-global-bugs.md).
