# Deep Research — Port Plan (Odysseus → Minnow)

> **Status:** Implemented (v1, 2026-06-04). Phase 5b (OG images) remains fast-follow. This is a self-contained spec for an LLM/engineer to
> build Minnow's **Deep Research** feature, ported from Odysseus's IterResearch engine.
>
> **Both repos are on this machine:**
> - Source (reference): `C:\Users\dukky\Documents\Development\odysseus` — Python/FastAPI.
> - Target (this repo): `C:\Users\dukky\Documents\Development\Minnow` — TypeScript/Vite SPA + Node Connect server + Electron.
>
> This is a **reimplementation in TypeScript/Node**, not a code copy. The Odysseus engine
> is provider-agnostic (LLM chat-completion calls + web search + page fetch), and Minnow
> already has all three primitives. Prompts and report CSS are copied **verbatim**.

---

## 0. Locked product decisions

These were decided with the product owner. Do not re-litigate without asking.

1. **Entry point: dedicated panel only.** Build a standalone **Deep Research** page (query
   box, live progress, result, library). **Remove the chat composer "Research" mode**
   entirely (see Phase 7). The `researcher` work-agent / sub-agent are *separate things* and
   stay (they are agents, not the composer mode).
2. **Report v1 is text-only.** Ship the editorial HTML report (typography, TOC, category
   theming, sources, export/print) **without** OG hero/section images. OG-image scraping +
   hide/reroll is a documented **fast-follow** (Phase 5b), not v1.
3. **Search: add SearXNG as a new built-in provider.** Research uses a **provider chain**
   (default: `searxng → tavily → brave → ddg`, configurable). Add a **new Settings → Search
   section** that owns the primary provider, the SearXNG instance URL, API keys, and the
   fallback chain. Search settings currently live under **Settings → Tools** (`tools.json`:
   `webSearchProvider`, `keys.braveApiKey`, `keys.tavilyApiKey`) — migrate them to the new
   section with backward-compatible reads.
4. **Dedicated research model binding.** A selectable provider+model used for the *many*
   engine LLM calls (plan, queries, per-page extraction, synthesis, stop, final). Falls back
   to the active chat model when unset. Lives in a new **Settings → Deep Research** section.
5. **Brave runs server-side** and is part of the research provider chain
   (`searxng → tavily → brave → ddg`). Add `server/tools/web-search-brave.js` (Phase 1).
6. **Report sanitizer = `isomorphic-dompurify`** (new runtime dependency). It bundles a DOM
   so DOMPurify runs server-side with no extra wiring (Phase 5.3).
7. **v1 scope includes** search/content **disk caching**, the **"Discuss this report"
   spinoff** (new chat seeded with the report), and **continuation / "Refine"** research
   (continue a prior run, feeding back report + visited URLs). **OG images stay a
   fast-follow** (Phase 5b), NOT v1.

---

## 1. How the Odysseus engine works (what we are porting)

Read these source files first; they are the source of truth:

| Odysseus file | Role |
|---|---|
| `src/deep_research.py` | **`DeepResearcher`** — the iterative loop + ALL prompts + JSON parsing |
| `src/goal_based_extractor.py` | `EXTRACTOR_PROMPT` (per-page extraction) |
| `src/research_utils.py` | `strip_thinking`, `is_low_quality` + `LOW_QUALITY_MARKERS` |
| `src/research_handler.py` | Task registry, persistence, query synthesis, continuation, report formatting |
| `routes/research_routes.py` | HTTP routes (start / SSE stream / status / cancel / result / library / detail / report / delete / archive) |
| `src/visual_report.py` | `generate_visual_report()` — markdown → standalone editorial HTML page (+ huge CSS `_TEMPLATE` and `_category_css`) |
| `static/js/researchSynapse.js` | Live SVG "synapse" progress animation |
| `services/search/core.py` | `_build_provider_chain`, `_call_provider` (provider fallback chain) |
| `services/search/content.py` | `fetch_webpage_content` (+ `_extract_og_image`, used by 5b) |

### The loop (`DeepResearcher.research`, `deep_research.py:247`)

Every step is an LLM call:

```
PLAN ─▶ [ THINK(queries) ─▶ SEARCH ─▶ EXTRACT(per page) ─▶ SYNTHESIZE ─▶ DECIDE ]×N ─▶ FINAL REPORT
         └────────────────────────── one round (cap = maxRounds) ──────────────────────┘
```

1. **PLAN** (`_create_plan`): LLM returns JSON `{sub_questions[], key_topics[], success_criteria}`. Also **auto-classifies a category** (`product`/`comparison`/`howto`/`factcheck`/general) that later changes report structure + CSS.
2. **THINK** (`_generate_queries`): JSON array of queries. Round 1 = 4 broad; later rounds = 3 gap-filling. Dedup across rounds.
3. **SEARCH + EXTRACT** (`_search_and_extract`): run all queries in parallel; collect new URLs (dedup vs already-fetched); fetch + extract concurrently under a **semaphore** (`extractionConcurrency`, default 3). Per page: fetch text → truncate to `maxContentChars` (15k) at a paragraph boundary → feed `EXTRACTOR_PROMPT` → parse JSON `{rational, evidence, summary}` → drop low-quality findings.
4. **SYNTHESIZE** (`_synthesize`): merge the last `synthesisWindow` (10) findings into an evolving report (180s timeout — it's heavy).
5. **DECIDE** (`_should_stop`): only **after `minRounds`** (3). LLM answers `YES`/`NO`; parsing strips `<think>` blocks and leading markdown/quotes, then checks `startsWith("YES")`. **On any error → continue.**
6. **FINAL REPORT** (`_final_report`): `FINAL_REPORT_PROMPT` asks for ≥1500 words; if `<400` words, auto-requests an expansion; appends category format override.

**Exit conditions:** LLM stop decision, `maxRounds` cap, `maxTime` wall clock, cooperative cancel, or `maxEmptyRounds` (2) consecutive empty rounds (= search down). Never throws away findings: synthesis failure → keep prior report; no report but findings exist → `_fallback_report` compiles raw findings.

**Why it reliably finishes/doesn't stop early** (port these behaviors exactly): hard `minRounds` floor before the stop question is even asked; the YES/NO parse strips reasoning `<think>` blocks (else reasoning models "never stop"); errors default to *continue*; the final report enforces a word-count floor with an expansion retry.

---

## 2. Target architecture in Minnow

New server module `server/research/` (mirrors `server/generations/`) + client module `src/research/`. Connect middleware registered in `server/runtime/middlewares.js`. Persistence under `~/.minnow/research/`. SSE for progress (same pattern as `server/generations/routes.js`).

```
server/research/
  prompts.js          # all prompts (verbatim from Odysseus) + current-date preamble
  strip-thinking.js   # port of research_utils.strip_thinking + is_low_quality
  llm.js              # server-side non-streaming chat-completion helper (the "LLM helper")
  search.js           # structured search: provider chain + fallback (searxng/tavily/brave/ddg)
  extractor.js        # fetch page text + EXTRACTOR_PROMPT → {rational,evidence,summary}
  engine.js           # DeepResearcher class (the loop)
  store.js            # in-memory task registry + ~/.minnow/research/<id>.json persistence
  visual-report.js    # markdown → standalone editorial HTML (text-only v1)
  routes.js           # createResearchMiddleware(): /api/research/*

server/tools/
  web-search-searxng.js   # NEW: SearXNG JSON search (text formatter for web_search tool)
  web-search-tavily.js    # refactor: export structured results too
  web-search-ddg.js       # refactor: export structured results too
  web-search-brave.js     # NEW (server-side): brave search for research chain

src/research/
  client.ts           # fetch wrappers for /api/research/*
  panel.ts            # Deep Research page: query box, options, start, result
  synapse.ts          # SVG progress animation (port of researchSynapse.js)
  library.ts          # library list/search/sort/open/delete/archive
  types.ts            # shared TS types (progress events, library item, etc.)

src/settings/        (or src/ui/settings-*)
  + Search section
  + Deep Research section
  - remove web-search controls from Tools section (keep keys readable for back-compat)
```

### Integration points already verified

- **Middleware registration:** add `connectApp.use(createResearchMiddleware())` in
  `server/runtime/middlewares.js` (the `applyMinnowMiddlewares` list).
- **Server-side LLM call:** `getProviderRuntime(providerId)` (from
  `server/providers/store.js`) returns `{ profile: { baseUrl }, paths: { chatCompletionsPath }, headers }`.
  POST to `` `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}` `` with
  `runtime.headers` and a non-streaming body (`stream:false`). See `server/generations/routes.js:88-96`.
- **Server tool dispatch:** `SERVER_TOOL_HANDLERS` map in
  `server/runtime/tools-middleware.js:855`. Existing `web_search_ddg`/`web_search_tavily`
  return formatted text. `fetch_web_content` → `toolFetchWebContent` → `fetchUrlText` +
  `truncateUtf8` from `src/lib/fetch-web-content.mjs`.
- **Config persistence:** `readConfigJson`/`writeConfigJson` + the resource API in
  `server/config/middleware.js`. Whitelist lives in `server/config/paths.js`
  (`ALLOWED_CONFIG_FILES`, `resourceToRelativeKey`) and the resource regex in
  `handleConfigRequest`. **Add `search.json` and `research.json` to all three.**
- **SSE pattern + background-task store:** copy the shape of `server/generations/store.js`
  (subscribers, append, markComplete/markError, cancel) and `routes.js` SSE handler.
- **Client SSE consumption pattern:** `src/api/generations.ts` (`subscribeToGeneration`)
  shows how the SPA reads `\n\n`-delimited SSE blocks. Reuse the parsing approach.
- **Markdown + sanitize:** `marked` (^12) and `dompurify` (^3) are already deps.

---

## 3. Config schemas (Phase 0)

### `~/.minnow/search.json`
```jsonc
{
  "provider": "searxng",                 // searxng | tavily | brave | duckduckgo | disabled
  "fallbackChain": ["tavily", "brave", "duckduckgo"],
  "searxngUrl": "http://localhost:8080", // base URL of a SearXNG instance
  "keys": { "braveApiKey": "", "tavilyApiKey": "" },
  "resultCount": 10
}
```

### `~/.minnow/research.json`
```jsonc
{
  "model": { "providerId": "", "model": "" }, // empty → use active chat model
  "searchProvider": "",      // optional research-specific override of search.json provider
  "maxRounds": 0,            // 0 = "Auto" (engine decides), cap 20
  "minRounds": 3,
  "maxTimeSeconds": 300,     // per-loop wall clock (engine)
  "runTimeoutSeconds": 1800, // hard wall clock (0 = unlimited)
  "maxReportTokens": 16384,
  "extractionTimeoutSeconds": 90,
  "extractionConcurrency": 3,
  "maxUrlsPerRound": 3,
  "maxContentChars": 15000,
  "synthesisWindow": 10,
  "maxEmptyRounds": 2
}
```

**Migration / back-compat:** on first read of `search.json`, if it is missing, seed
`provider`/`keys` from existing `tools.json` (`webSearchProvider`, `keys.*`). Keep reading
`tools.json` keys as a fallback so nothing breaks mid-migration. The legacy `web_search`
tool (`web-search-routing.ts`, server `toolWebSearch*`) should read `search.json` first,
then fall back to `tools.json`.

**Validators:** add `normalizeSearchConfig` / `normalizeResearchConfig` in
`server/config/validators.js` (clamp numbers, whitelist provider strings, default chain).
Add the two files to `ALLOWED_CONFIG_FILES`, `resourceToRelativeKey`, and the resource regex
in `server/config/middleware.js`.

---

## 4. Phase-by-phase implementation

> Recommended order: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7**. Phases 1–5 are server-only and
> independently testable with `node --test` before any UI exists.

### Phase 0 — Config & settings plumbing
**Read first:** `server/config/paths.js`, `server/config/validators.js`,
`server/config/middleware.js`, `server/config/store.js`, `src/tools/tool-settings-types.ts`,
`src/ui/settings-sections.ts` (+ the settings-search-index/rank tests).

1. Add `search.json` + `research.json` to the config whitelist/resource map/regex.
2. Add validators + defaults + the `tools.json` migration described in §3.
3. Add **Settings → Search** section: provider dropdown (incl. **SearXNG**), SearXNG URL
   field, Brave/Tavily key fields, fallback-chain editor, result count.
4. Add **Settings → Deep Research** section: research model picker (reuse the provider+model
   selection UI used elsewhere — see `src/api/models.ts` / provider list), engine params
   (maxRounds, maxTime, runTimeout, extraction timeout/concurrency, maxReportTokens).
5. Remove the web-search controls from the Tools section UI (the persisted `tools.json` keys
   stay for back-compat reads).
6. Update settings HTML/search-index tests (`test/ui/settings-*`) for the new sections.

**Acceptance:** GET/PUT `/api/config/search` and `/api/config/research` round-trip; settings
pages render and persist; `npm test` settings suites pass.

### Phase 1 — Structured search + SearXNG (server)
**Read first:** `server/tools/web-search-tavily.js`, `web-search-ddg.js`,
`server/runtime/tools-middleware.js` (handlers + `SERVER_TOOL_HANDLERS`),
`src/tools/web-search-routing.ts`. In Odysseus: `services/search/core.py`
(`_build_provider_chain`, `_call_provider`).

Define the structured result type:
```ts
interface SearchResult { title: string; url: string; snippet: string; }
```

1. **`server/tools/web-search-searxng.js`** — `GET {searxngUrl}/search?q=<q>&format=json`
   → map `results[]` to `{title, url, content→snippet}`. Add a `web_search_searxng` text
   formatter + register in `SERVER_TOOL_HANDLERS` so it's also usable as a normal tool.
2. **Refactor** tavily/ddg/brave handlers to expose a **structured** function returning
   `SearchResult[]` (keep the existing text formatters for the `web_search` tool). Tavily
   already has `payload.results`; DDG already parses title/href/snippet in
   `parseDdgHtmlResults` (return structured rows instead of pre-numbered strings).
3. **`server/tools/web-search-brave.js`** (NEW, server-side): Brave is currently
   browser-routed; research runs server-side, so implement a server Brave call (key from
   `search.json`/`tools.json`). Brave API: `GET https://api.search.brave.com/res/v1/web/search?q=`
   with header `X-Subscription-Token`.
4. **`server/research/search.js`** — `searchStructured(query, { provider?, count? }): Promise<SearchResult[]>`:
   build provider chain from `research.json.searchProvider || search.json.provider` + fallback
   chain; try each provider in order; first non-empty wins; record which provider produced
   results (for the report stats "Search" line); set a `lastSearchError` for the engine's
   empty-round messaging. Mirror `_build_provider_chain`/`_call_provider` semantics
   (including "all providers ran, none returned → actionable error", Odysseus issue #344).
5. **`server/research/cache.js`** (v1) — small disk cache under `~/.minnow/research/cache/`:
   `getSearch(key)`/`setSearch(key, results)` and `getPage(url)`/`setPage(url, text)`, with a
   2h TTL like Odysseus (`services/search/cache.py`). `searchStructured` and the extractor
   (Phase 3) consult it before the network. Hash keys; fail open on corrupt/missing files.

**Acceptance:** unit tests for SearXNG JSON parsing, structured tavily/ddg/brave shapes,
chain fallback (primary empty → next provider) with mocked `fetch`, and cache hit/expiry.

### Phase 2 — LLM helper + text utils (server)
**Read first:** `server/providers/store.js` (`getProviderRuntime`),
`server/generations/routes.js:88-96`, `server/generations/upstream.js`. Odysseus:
`src/llm_core.py` (`llm_call_async`), `src/research_utils.py`.

1. **`server/research/strip-thinking.js`** — port `strip_thinking` (remove `<think>…</think>`
   and prompt-echo artifacts) and `is_low_quality(summary)` with the verbatim
   `LOW_QUALITY_MARKERS` list (`research_utils.py:32`). Check whether `src/markdown` or
   `src/api/reasoning.ts` already has reasoning-strip logic to reuse; otherwise port fresh.
2. **`server/research/llm.js`** —
   ```ts
   async function llmCall({ providerId, model, messages, temperature = 0.3,
     maxTokens = 4096, timeoutMs = 60000, signal }): Promise<string>
   ```
   - Resolve `getProviderRuntime(providerId)`; POST non-streaming JSON
     (`{ model, messages, temperature, max_tokens, stream:false }`) to
     `` `${baseUrl}${chatCompletionsPath}` `` with `headers`; `AbortController` for timeout;
     return `choices[0].message.content` then `stripThinking(...)`. One retry on transient
     failure (mirror Odysseus `max_retries=1`).
   - When `research.json.model` is empty, the caller passes the active chat provider/model.

**Acceptance:** test with a mock provider runtime + mocked `fetch` (success, timeout, retry,
`<think>` stripping).

### Phase 3 — Core engine (server)
**Read first:** `deep_research.py` in full, `goal_based_extractor.py`.

1. **`server/research/prompts.js`** — copy these **verbatim** (escape JS template literals):
   `RESEARCH_PLAN_PROMPT`, `QUERY_GEN_PROMPT`, `SYNTHESIZE_PROMPT`, `STOP_PROMPT`,
   `FINAL_REPORT_PROMPT`, `CATEGORY_PROMPTS` (product/comparison/howto/factcheck),
   `EXTRACTOR_PROMPT`, and `currentDateContext()` (the real-date preamble, `deep_research.py:24`).
2. **`server/research/extractor.js`** — `fetchAndExtract(url, question, title)`:
   fetch the page through a **research-specific fetch** (NOT the 8 KB `fetchUrlText` tool cap):
   reuse `validateHttpUrl` + `stripHtmlToPlainText` from `fetch-web-content.mjs` but gate the
   URL through `assertPublicUrl` (§5 SSRF) and allow up to `maxContentChars` (~15 KB) →
   truncate at a paragraph boundary → `llmCall(EXTRACTOR_PROMPT)` → `parseJsonObject` →
   `{rational, evidence, summary, url, title}`; drop if `isLowQuality(summary)`; on JSON-parse
   failure, keep raw response as evidence (mirror `_fetch_and_extract`). Consult the page cache
   (Phase 1.5) first. **v1: no og_image.**
3. **`server/research/engine.js`** — port `DeepResearcher` as a class:
   - Constructor params = the `research.json` knobs + `progressCallback`, `searchProvider`,
     `category`, `providerId`, `model`.
   - Methods: `research({ priorReport?, priorFindings?, priorUrls? })`, `createPlan()`,
     `classifyCategory()`, `generateQueries()`, `searchAndExtract()` (parallel search +
     semaphore-bounded extract — implement a small `pLimit(n)` since Node has no
     `asyncio.Semaphore`), `synthesize()`, `shouldStop()`, `finalReport()`, `formatFindings()`,
     `fallbackReport()`, `getStats()`, `cancel()`.
   - **Continuation (v1):** `research()` accepts a prior report + prior findings + already-
     visited URLs and continues from them (port the `prior_report`/`prior_findings`/
     `prior_urls` args of `DeepResearcher.research`). The start route exposes this via
     `continueFrom` (see Phase 4).
   - **Port the JSON-repair helpers exactly** (`_parse_json_array`, `_parse_json_object`,
     `_strip_code_block`): they handle truncated arrays, code fences, and models echoing the
     example array (keep the **last** parseable array). These are load-bearing for weak
     local models.
   - **Port the stop-decision hardening exactly** (`shouldStop`): strip thinking, strip
     leading `[\s*_`"'>#-]+`, uppercase, `startsWith("YES")`, **default continue on error**.
   - **Port the final-report word-count floor + expansion retry** (`finalReport`).
   - Emit progress via `progressCallback(event)`; event shapes in §5.

**Acceptance:** an engine test with a **mock `llmCall`** (scripted plan/queries/extract/
synthesis/stop/final) and **mock `searchStructured`** that asserts: round floor respected
(no stop before minRounds), empty-round termination, JSON-array repair, stop parse with a
`<think>` block, fallback report when synthesis returns empty.

### Phase 4 — Task store + persistence + routes (server)
**Read first:** `server/generations/store.js`, `server/generations/routes.js`,
`research_handler.py` (registry, `_save_result`, `get_*`), `routes/research_routes.py`.

1. **`server/research/store.js`** — registry keyed by `researchId`:
   `{ id, query, status: 'running'|'done'|'error'|'cancelled', progress, result, rawReport,
   sources, rawFindings, stats, category, startedAt, completedAt }`. Subscribers list for SSE
   (append/flush/close). `startResearch(opts)` spawns the engine under a **hard timeout**
   (`runTimeoutSeconds`; 0 = none) — on timeout, persist the engine's evolving report rather
   than discarding (port `research_handler.py:323` branch). On finish, persist to
   `~/.minnow/research/<id>.json`. **No multi-tenant owner-scoping needed** (Minnow is
   local/single-user) — drop the Odysseus `owner` checks.
   - Sources/findings extraction: port `_extract_sources` / `_extract_raw_findings`
     (dedupe by url, filter low-quality).
2. **`server/research/routes.js`** — `createResearchMiddleware()` handling:
   | Route | Method | Purpose |
   |---|---|---|
   | `/api/research/start` | POST | `{query, maxRounds?, searchProvider?, category?, providerId?, model?, continueFrom?, ...overrides}` → `{ researchId }` |
   | `/api/research/stream/:id` | GET | SSE progress (mirror generations SSE headers) |
   | `/api/research/status/:id` | GET | status + progress snapshot |
   | `/api/research/cancel/:id` | POST | cooperative cancel |
   | `/api/research/result/:id` | GET | `{ result, sources, rawFindings, category }` |
   | `/api/research/report/:id` | GET | **text/html** visual report (Phase 5) |
   | `/api/research/library` | GET | `?search&sort&archived&limit` list |
   | `/api/research/detail/:id` | GET | full JSON |
   | `/api/research/:id/archive` | POST | `?archived=bool` |
   | `/api/research/:id` | DELETE | delete on disk |
   - Validate `:id` with a strict regex (e.g. `^rs-[a-f0-9]{12}$`). Use the same JSON-body
     reader + CORS helpers as the existing middlewares.
   - **`continueFrom` (continuation, v1):** when present, load that prior research's
     `rawReport` + `rawFindings` + source URLs and pass them into `engine.research({prior…})`
     so the new run fills gaps instead of starting over (port `routes/research_routes.py`
     continuation + `chat_routes.py:744` prior-load logic).
   - **No server spinoff route.** Minnow chat sessions are **client-side state**
     (`src/state/sessions.ts`), not server-managed like Odysseus. Spinoff is done in the
     client (Phase 6.6): fetch `/result/:id`, create a chat with `createEmptyChatObject` /
     `createAndActivateChat`, push a system message containing the report (report-only, no raw
     sources, per Odysseus), `scheduleSaveSessions()`, then `switchActiveChat()`.
3. Register `createResearchMiddleware()` in `server/runtime/middlewares.js` and add the URL
   to the startup log list in `server.js`.

**Acceptance:** route tests (start → poll status → SSE emits progress → result persisted to a
temp `MINNOW_HOME` → library lists it → delete removes it). Use `MINNOW_HOME=<temp>`.

### Phase 5 — Visual report, text-only (server)
**Read first:** `src/visual_report.py` in full. Minnow deps: `marked`, `dompurify`.

Port `generate_visual_report(question, reportMarkdown, sources, stats, category, researchId)`:
1. `stripThinking` the markdown; `extractReportTitle` (first heading or query); promote
   bold-only lines to `##` when no headings exist.
2. **Markdown → HTML:** use `marked` (enable GFM tables). Add `target="_blank" rel="noopener"`
   to external links. Autolink bare URLs (port `_autolink_urls`).
3. **Sanitize** the rendered HTML (it's built from untrusted web text) with
   **`isomorphic-dompurify`** (add to `dependencies`; it bundles a DOM so DOMPurify runs
   server-side). Port the Odysseus nh3 allowlist to the DOMPurify config: allow
   `details`/`summary`, heading `id`s, table `align`, code classes; forbid
   scripts/inline handlers/`javascript:`. Note the report's own export/colorizer `<script>`
   is added to the template **after** sanitization (it's first-party, not from the model).
4. Port `extractHeadings` + `applyHeadingIds` (TOC with stable slugs + scroll-spy), the
   **stats bar**, the **collapsible sources panel**, and the export/print/ESC `<script>`.
5. Port the **`_TEMPLATE`** (the big CSS document) and **`_category_css`** **verbatim** from
   `visual_report.py` (lines ~223–1660). It's standalone CSS — keep Odysseus's editorial
   palette/fonts for the *report page* (this is intentionally NOT the Minnow app theme; the
   report is a shareable artifact). Category theming (product/comparison/howto/landscape)
   ports as-is, including the comparison-table cell colorizer script.
6. **OMIT for v1:** hero image, section-image injection, reroll/hide buttons, `og_image_meta`,
   spare-image pool, restore-hidden toolbar. Leave the insertion points commented so 5b can
   add them.

**Acceptance:** snapshot/HTML tests — `<script>` from a malicious finding is stripped; TOC
ids match headings; tables render; category class is applied.

### Phase 5b — OG images (FAST-FOLLOW, not v1)
Add OG/meta image extraction to the fetch step (port `_extract_og_image`,
`content.py:129`), thread `ogImage` through findings → sources, then port the hero/section
image injection + hide/reroll endpoints (`/api/research/:id/hide-image`,
`/unhide-images`) and the report image `<script>`. Tracked separately.

### Phase 6 — Frontend: panel + synapse + library (client)
**Read first:** `src/main.ts` (init wiring), `src/ui/benchmark-page.ts` (cleanest full-page
template), `src/ui/settings-page.ts` (section routing), `src/state/sessions.ts` (chat
creation), `src/api/generations.ts` (SSE consumption), `DESIGN.md` (use `--mn-*` OKLCH tokens
— do NOT hardcode the report's terracotta palette in the app UI), `static/js/researchSynapse.js`.

**Verified routing pattern (follow it exactly):** pages are hash-routed
(`#/benchmark`, `#/settings/<section>`) full-page overlays. Each page module exports
`init<Page>Page()` (builds DOM into a root element like `#benchmarkView`, registers a
`hashchange` listener that show/hides the root) and `open<Page>FromTopbar()` (sets
`window.location.hash`). `main.ts → initApp()` dynamically imports + calls each `init*Page()`
(see lines 298-305); `registerWindowHandlers()` (lines 182-190) wires
`window.open<Page>FromTopbar` for topbar buttons. → Add `#research` root in `index.html`,
`src/research/panel.ts` exporting `initResearchPage()` + `openResearchFromTopbar()`, call
`initResearchPage()` in `initApp()`, add a topbar button + `window.openResearchFromTopbar`.
The two new settings sections plug into the `SECTIONS` array + `settingsSection-${id}` panels
+ `[data-settings-nav]` + a `refreshSettingsSection` case (`settings-page.ts:44-72`).

1. **`src/research/client.ts`** — typed wrappers for every `/api/research/*` route; an SSE
   subscriber for `/stream/:id` reusing the block-parsing approach from `generations.ts`.
2. **`src/research/panel.ts`** — a `#/research` page: query textarea; options (rounds:
   Auto/1–20, category: Auto/product/…, optional provider + model override defaulting to the
   research binding); **Start** button → `POST /start` → subscribe to SSE → render the
   synapse; on `done`, fetch `/result/:id`, render summary + sources, and a button to **open
   the visual report** (`/api/research/report/:id`) in the Electron preview pane or a new
   tab. Cancel button → `/cancel/:id`.
3. **`src/research/synapse.ts`** — port `researchSynapse.js` to TS (SVG nodes/edges, phase
   label map `PHASE_LABEL`, round/source counters, timer). Drive it from SSE progress events.
4. **`src/research/library.ts`** — list (search/sort/archived) via `/library`, open detail
   (`/detail/:id`), open report, archive, delete. A library entry point in the panel/nav.
5. Add a **nav entry / route** for Deep Research (follow how other pages like settings/
   benchmark register their `#/…` routes).
6. **Result actions (v1):** on the result + each library item, add **Discuss** — *client-side
   spinoff*: fetch `/result/:id`, `createAndActivateChat(model)`, push a system message with
   the report into the new chat's history, `scheduleSaveSessions()`, `switchActiveChat()`,
   leave the research page. And **Refine** — `POST /start` with `continueFrom: id` (new run
   continuing the prior one). (No server spinoff route — sessions are client state.)
7. Styling per `DESIGN.md`: flat surfaces, borders not cards, JetBrains Mono for stats,
   semantic colors only for metrics.

**Progress event contract (server `progressCallback` → SSE `data:` JSON):**
```ts
type ResearchProgress =
  | { phase: 'probing'; model: string }
  | { phase: 'planning' }
  | { phase: 'searching'; round: number; queries?: number; queryPreview?: string; totalSources: number }
  | { phase: 'reading'; round?: number; url?: string; title?: string; newSources?: number; totalSources: number; totalFindings?: number }
  | { phase: 'analyzing'; round: number; totalSources: number; totalFindings: number }
  | { phase: 'writing'; message?: string; totalSources: number; totalFindings: number }
  | { phase: 'warning'; message: string }
  | { phase: 'error'; message: string };
// terminal SSE block: { status: 'done'|'error'|'cancelled', final: true }
```
Keep these field names aligned with `_emit(...)` calls in `deep_research.py` so the synapse
port maps 1:1.

**Acceptance:** UI tests in the `happy-dom` style already used under `test/ui/*` — synapse
renders/advances on mock events; panel start disables/enables correctly; library renders a
mock list. Add a smoke run.

### Phase 7 — Remove the chat "Research" mode
**Read first (grep `'research'` mode usages):** `src/chat/modes/registry.ts`,
`src/chat/modes/types.ts` (`MODE_IDS`), `src/ui/mode-selector.ts`,
`src/chat/prompts/modes/research.full.md` + `research.lite.md`, `src/chat/prompts/prompt-composer.ts`,
`src/benchmark/suites/modes.ts`, `src/benchmark/test-catalog.ts`, `src/ui/settings-sections.ts`,
and all `test/**` referencing the research mode (e.g. `test/modes/*`, `test/ui/settings-sections.test.*`,
benchmark mode tests).

1. Remove the `research` entry from `MODE_DEFINITIONS` (`registry.ts:78`) and from `MODE_IDS`
   (`types.ts`). Remove `RESEARCH_EXTRA_DENIED_TOOLS` if now unused.
2. Delete `modes/research.full.md` + `research.lite.md` and any loader/registry references.
3. Update benchmark suites/catalog and the mode-selector UI.
4. Fix every failing test; update prompt/mode snapshot tests.
5. **Keep** the `researcher` work-agent (`src/chat/prompts/work-agents/researcher/…`) and
   `researcher` sub-agent (`src/agents/prompts/sub-agents/researcher.*`) — resolved (D7): they
   are shipped/enabled defaults, independent of the composer mode. Do NOT touch them.
   Note `test/prompts/research-mode-pipeline.test.mjs` tests the **mode** pipeline — remove/
   rewrite it as part of mode removal (it is not about the researcher agent).

**Acceptance:** `npm test` green; no dangling `'research'` mode id; composer no longer offers
Research; Deep Research lives only in the new panel.

---

## 5. Cross-cutting concerns

- **SSRF / fetch safety — VERIFIED MISSING, must add.** `fetchUrlText`
  (`src/lib/fetch-web-content.mjs:145`) only checks the protocol is http(s)
  (`validateHttpUrl`, line 18). There is **no** private-IP/loopback/link-local/metadata
  (`169.254.169.254`) block, **no** DNS-resolution check, and `fetch` **follows redirects by
  default** (a public URL can redirect to `10.x`/`::1`/metadata). The engine auto-fetches
  dozens of arbitrary result URLs unattended → real SSRF surface. **Add an `assertPublicUrl(url)`
  guard** (reject RFC1918, loopback, link-local `169.254/16`, ULA `fc00::/7`, `::1`; resolve
  hostname→IP to catch rebinding; disallow or manually re-validate redirects) and route the
  research extractor's fetch through it. SearXNG/brave/tavily endpoints are config-controlled
  and exempt. Retrofitting `fetchUrlText` itself is recommended but out of this scope.
- **Page-fetch byte cap — VERIFIED.** `WEB_TEXT_MAX_BYTES = 8192` (8 KB) caps the existing
  tool path. The engine wants ~15 KB (`maxContentChars`), so the extractor must use its **own**
  fetch with a larger limit, NOT reuse the 8 KB `truncateUtf8` cap.
- **Report XSS:** the report is built from untrusted scraped text and served as HTML — the
  DOMPurify allowlist (Phase 5.3) is mandatory, not optional.
- **Caching (v1):** `server/research/cache.js` caches search results + page content (2h TTL)
  under `~/.minnow/research/cache/` to cut repeat-run cost (Phase 1.5).
- **Secrets:** API keys live server-side in `search.json`; never send keys to the client.
  The settings UI writes keys via `PUT /api/config/search`; reads should mask them.
- **Persistence dir:** create `~/.minnow/research/` in the bootstrap layout
  (`server/config/home.js` / `ensureMinnowLayout`).

---

## 6. Testing strategy (match Minnow conventions)

Minnow uses `node --test` + `tsx` (see `package.json` `test` script). Put new tests under
`test/research/`:
- `engine.test.mts` — loop behavior with mocked `llmCall` + `searchStructured`.
- `json-parse.test.mts` — array/object repair + last-array-wins.
- `stop-decision.test.mts` — `<think>` stripping, markdown tolerance, continue-on-error.
- `search-chain.test.mjs` — provider fallback; `searxng.test.mjs` — JSON parse.
- `llm-helper.test.mts` — runtime resolve, timeout, retry, strip-thinking.
- `routes.test.mjs` — start/status/stream/result/library/delete against temp `MINNOW_HOME`.
- `visual-report.test.mjs` — sanitize, TOC ids, tables, category class.
- `src/research/*` UI tests under `test/ui/` in the existing happy-dom style.
- Add new scripts to the big `test` chain (or a `test:research` script) and wire into CI.
- Update/replace tests broken by Phase 0 (settings) and Phase 7 (mode removal).

---

## 7. Resolved decisions + remaining open item

**Resolved with the owner (folded into the phases above):**
- **D1 — Brave server-side:** ✅ included. `server/tools/web-search-brave.js`; chain is
  `searxng → tavily → brave → ddg` (Phase 1).
- **D2 — Report sanitizer:** ✅ **`isomorphic-dompurify`** added to `dependencies` (Phase 5.3).
- **D3 — Spinoff:** ✅ in v1 — **client-side** (sessions are client state); **Discuss** button
  creates the chat in the browser (Phase 6.6). No server spinoff route.
- **D4 — Continuation:** ✅ in v1 — `continueFrom` on `/start` + **Refine** button (Phases 3, 4, 6).
- **D5 — Caching:** ✅ in v1 — `server/research/cache.js` (Phase 1.5).
- **D6 — OG images:** deferred to **Phase 5b** fast-follow (not v1).

- **D7 — Researcher agents:** ✅ resolved → **KEEP.** Verified the `researcher` is a shipped,
  registered, **enabled** default in *both* the work-agent registry
  (`src/chat/prompts/work-agents/registry.json:10`, composer-selectable) and the sub-agent
  defaults (`src/agents/defaults/sub-agents.json:76`, `"enabled": true`, orchestrator-spawnable),
  with prompts + sampler/thinking defaults + `server/work-agents/registry.js`. They are active
  features, independent of the composer "Research" mode, so they are NOT unused — keep them.
  (Owner's rule was "remove only if no longer used.") Phase 7 still removes the **mode** and
  must fix `test/prompts/research-mode-pipeline.test.mjs`.

---

## 8. Milestones / acceptance summary

| Milestone | Done when |
|---|---|
| M1 Config | `search.json` + `research.json` round-trip; Search + Deep Research settings sections render/persist; web-search controls removed from Tools |
| M2 Search | `searchStructured` returns `SearchResult[]` with SearXNG primary + fallback chain; tests green |
| M3 Engine | `llmCall` + `engine.js` complete a full run end-to-end with mocked deps; loop-control tests green |
| M4 Backend wired | `/api/research/*` live; a real run from `curl`/script persists to `~/.minnow/research/` and streams progress |
| M5 Report | `/api/research/report/:id` returns a sanitized editorial HTML page with TOC + sources + category theming |
| M6 UI | Deep Research panel runs a real query with live synapse + result + report open; library lists/opens/deletes; **Discuss + Refine** work |
| M7 Cleanup | Chat Research mode removed; full `npm test` green |

When M6 lands you have **full feature parity with Odysseus except OG images** (Phase 5b
fast-follow). Caching, spinoff, and continuation are in v1.
