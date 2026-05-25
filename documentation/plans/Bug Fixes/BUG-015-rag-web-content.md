---
name: BUG-015 — rag_web_content (Web RAG)
overview: Fix the browser-routed Web RAG tool so it returns query-relevant excerpts from HTTP(S) pages. Plan only — no implementation in this document.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-015)
related_bugs: [BUG-010, BUG-011]
todos:
  - id: reproduce-classify
    content: Reproduce with 3 URLs; classify failure as fetch error, empty ranking, or routing/enablement
    status: completed
  - id: capture-payloads
    content: Log full tool result strings and browser console for each failure class
    status: completed
  - id: unit-test-fetch-rank
    content: Add test/tools/browser-executor-rag.test.mts with mocked fetch + rankSentencesByQuery cases
    status: pending
  - id: decide-fetch-strategy
    content: Choose fix path — shared server proxy (BUG-011), CDP read, or browser-only improvements
    status: pending
  - id: implement-fetch-layer
    content: Implement chosen fetch layer for fetch_web_content + rag_web_content together
    status: pending
  - id: harden-ranking
    content: Improve stripHtml/sentence split/term scoring so successful fetches return excerpts
    status: pending
  - id: wire-client-fallback
    content: If server proxy added, route rag_web_content (and fetch) via client.ts like web_search_ddg
    status: pending
  - id: manual-research-qa
    content: Manual QA in Research mode + researcher sub-agent with tool enabled
    status: pending
  - id: update-context-md
    content: Update documentation/context.md Web tools table after fix ships
    status: pending
isProject: false
---

# BUG-015 — `rag_web_content` (Web RAG) broken

| Field | Value |
|-------|-------|
| **ID** | BUG-015 |
| **Severity** | Major |
| **Status** | Verified (open) — [MIN-72](https://linear.app/minnowai/issue/MIN-72/bug-015-rag-web-content-broken) |
| **Source** | [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) |
| **Primary code** | [`src/tools/browser-executor.ts`](../../../src/tools/browser-executor.ts) — `toolRagWebContent`, `fetchUrlText`, `rankSentencesByQuery` |
| **Routing** | [`src/tools/client.ts`](../../../src/tools/client.ts) — `serverRequired: false` → `executeBrowserTool` |
| **Catalog** | [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) — id `rag_web_content`, label **Web RAG** |

---

## Problem statement

**Web RAG** (`rag_web_content`) is reported **non-functional**: it does not return useful ranked excerpts for a URL + query. Observed outcomes match the bug-hunt session — hard **fetch** failure (`Error: fetch failed … CORS`), empty ranking (`No relevant sentences found …`), or generic tool failure — rather than a formatted excerpt list.

**Expected:** Fetch page text, score sentences by query relevance, return up to eight numbered excerpts.

**Actual (bug-hunt):** Tool does not work; same failure class as **BUG-011** (`fetch_web_content`).

**Downstream impact:** Research mode and the **Research worker** sub-agent (`researcher`) list `rag_web_content` in allowed tools; broken RAG weakens multi-source research without a reliable excerpt path.

### Verification summary (2026-05-24)

| URL | Browser SPA | Classification |
|-----|-------------|----------------|
| `https://example.com` | `Failed to fetch` | **A** |
| `https://www.bbc.com/news` | `Failed to fetch` | **A** |
| `https://en.wikipedia.org/wiki/Main_Page` | `Failed to fetch` | **A** |
| `https://developer.mozilla.org/.../CORS` (Node only) | HTTP 200, `No relevant sentences found` | **C** (+ **E** truncate) |

Primary issue is **Class A** (browser CORS). Fix with **BUG-011** server fetch proxy; then harden ranking for **C/E**.

---

## Current architecture

```mermaid
flowchart LR
  subgraph client
    ET[executeTool]
    BE[executeBrowserTool]
    TR[toolRagWebContent]
    FU[fetchUrlText]
    RK[rankSentencesByQuery]
  end
  ET --> BE
  BE --> TR
  TR --> FU
  FU -->|browser fetch| URL[HTTP(S) origin]
  TR --> RK
```

| Step | Function | Behavior |
|------|----------|----------|
| 1 | `executeTool` | No special case for `rag_web_content` (unlike `web_search` → `web_search_ddg`). |
| 2 | `toolRagWebContent` | Requires `url` + `query`; validates via `stringArg`. |
| 3 | `fetchUrlText` | Browser `fetch()` → strip HTML → plain text; CORS/network errors return `Error: fetch failed (…)`. **Shared with `fetch_web_content`.** |
| 4 | `truncateUtf8` | Caps text at **8192** bytes (`WEB_TEXT_MAX_BYTES`) **before** ranking. |
| 5 | `rankSentencesByQuery` | Query terms (length > 1), sentences (length > 20, split on `(?<=[.!?])\s+`), score by term overlap, top **8**. |

**Not used today:** Server `POST /api/tools` (no handler in [`server.js`](../../../server.js) — only `web_search_ddg` among web tools), CDP `browser_*` stack (**BUG-010**).

**Enablement:** Tool defaults off in migration fixtures; user must enable **Settings → Tools** (permission id `rag_web_content`).

---

## Failure modes to classify during investigation

Before coding, every reproduction should be bucketed — fixes differ.

| Class | Symptom | Likely cause |
|-------|---------|----------------|
| **A — Fetch** | `Error: fetch failed (…). The site may block cross-origin requests (CORS).` | Browser-only `fetch`; same as **BUG-011**. Most sites block SPA origin. |
| **B — HTTP** | `Error: HTTP 4xx/5xx for …` | URL, auth, or bot blocking (not CORS). |
| **C — Empty rank** | `No relevant sentences found on {url} for query: {query}` | Fetch succeeded but `rankSentencesByQuery` returned `[]`. |
| **D — Routing** | `Error: unknown tool` / tool not in catalog | Disabled in settings or mode filter. |
| **E — Truncation** | Short/irrelevant excerpts only | 8KB cap removes body before ranking. |

### Code-level hypotheses for class C (ranking)

These are worth verifying with unit tests (no network):

1. **`stripHtmlToText`** collapses all whitespace to single spaces (`replace(/\s+/g, ' ')`), which can remove paragraph breaks and leave few `.!?`-delimited segments — one long “sentence” or poor splits.
2. **Sentence regex** `(?<=[.!?])\s+` fails on minified HTML text, bullet lists, or headings without terminal punctuation.
3. **Query terms** — tokens ≤ 1 character after `[^\w]` strip are dropped; single-letter acronyms never score.
4. **Minimum sentence length** (> 20 chars) drops valid short lines (titles, labels).
5. **Scoring** is exact substring match only (no stemming/synonyms) — legitimate queries score zero.

Class C can make the tool *look* broken in chat even when **BUG-011** is fixed for CORS-friendly URLs.

---

## Relationship to other bugs

| Bug | Relationship |
|-----|----------------|
| **BUG-011** (`fetch_web_content`) | Shares `fetchUrlText` + `stripHtmlToText` + 8KB cap. **Fix fetch once for both tools.** |
| **BUG-010** (CDP `browser_*`) | Alternative read path for CORS/login pages via `browser_navigate` + `browser_eval`; skill doc already steers “CORS-blocked” to CDP. Optional follow-up: document or automate RAG-over-CDP — out of scope unless product wants one tool. |
| **BUG-015** | Adds ranking layer; can fail independently after fetch succeeds. |

**Recommendation:** Treat **BUG-011 + BUG-015** as one **web fetch** initiative with two acceptance tracks (full page vs ranked excerpts), not two unrelated patches.

---

## Reproduction checklist

Prerequisites: `npm start`, tool **enabled** in Settings, model with tool loop.

| # | Step | Record |
|---|------|--------|
| 1 | Enable `rag_web_content` (and `fetch_web_content` for comparison). | Settings state |
| 2 | **CORS-friendly URL** — e.g. `https://example.com` + query `example domain` | Full tool result string |
| 3 | **CORS-hostile URL** — e.g. major news/docs site + topical query | Compare to step 2 |
| 4 | Same URLs with **`fetch_web_content`** only | Confirm shared fetch path |
| 5 | Research mode or chat with `rag_web_content` in allowed tools | Agent actually invokes tool name |
| 6 | Optional: `localStorage.minnowDebugTurns = '1'` | Turn / tool routing logs |

**Fixture URLs for tests (deterministic):** use mocked `fetch` in unit tests; manual QA can use `example.com`, Wikipedia REST (if CORS allows), and one known-blocked origin.

---

## Fix options (decision required)

### Option 1 — Server-side HTTP fetch proxy (recommended if BUG-011 uses same approach)

Add server handlers (e.g. `fetch_web_content` / `rag_web_content` or internal `fetch_url_text`) that perform Node `fetch` without browser CORS, strip HTML server-side, return text.

| Pros | Cons |
|------|------|
| Fixes **A** for most public pages in one place | SSRF risk — need URL allowlist, size cap, timeout |
| Matches `web_search_ddg` precedent | Duplicates strip/rank logic unless shared module |
| Works in Research workers without CDP | Does not help login-only pages |

**Client change:** When `isLocalServerAvailable()`, route `fetch_web_content` and `rag_web_content` to server (mirror `web_search` / `web_search_ddg` pattern in [`client.ts`](../../../src/tools/client.ts)).

### Option 2 — Browser-only improvements (narrow)

Only adjust `rankSentencesByQuery` / `stripHtmlToText` / chunking; keep browser `fetch`.

| Pros | Cons |
|------|------|
| Small diff, no SSRF surface | Does not fix **A** on most real sites |
| Good if reproduction is **only** class C | Leaves Research mode blocked on typical URLs |

Use as **supplement** to Option 1, not sole fix.

### Option 3 — CDP-based page text extraction

Use live Chrome tab (`browser_navigate` + `browser_eval` to read `document.body.innerText`) then rank in browser or server.

| Pros | Cons |
|------|------|
| Handles CORS and many SPAs | Depends on **BUG-010**; heavier UX |
| Aligns with browser-automation skill | Poor fit for “one-shot URL” tool ergonomics |

Consider **documentation + agent prompt** guidance first; optional future `rag_web_content` fallback when CDP enabled.

### Option 4 — Raise cap / rank before truncate

Increase `WEB_TEXT_MAX_BYTES` for RAG only, or rank on full text then truncate **output** excerpts.

| Pros | Cons |
|------|------|
| Cheap improvement for class **E** | Memory/latency; does not fix CORS |

---

## Recommended approach (phased)

**Phase 1 — Diagnose (blocking)**  
Complete todos `reproduce-classify` and `capture-payloads`. Decide if primary issue is **A** vs **C**.

**Phase 2 — Shared fetch (with BUG-011)**  
Implement **Option 1** unless reproduction proves only class C on CORS-open URLs. Extract shared text extraction (strip HTML, UTF-8 truncate) into a module usable by browser executor and server handler to avoid drift.

**Phase 3 — Ranking hardening (BUG-015 specific)**  
Implement **Option 2** items:

- Split sentences on newlines **and** punctuation after strip (or preserve block boundaries in `stripHtmlToText`).
- Fallback chunking: if zero scored sentences, return top N fixed-size windows by query term density.
- Optional: rank **before** 8KB truncate, then truncate **output** strings only.

**Phase 4 — Tests & docs**  
Unit tests with mocked responses; manual Research QA; update [`documentation/context.md`](../../context.md) Web tools row.

**Out of scope for initial fix**

- Embeddings / vector RAG (tool name is “sentence overlap RAG”, not vector DB).
- New in-app browser chrome (bug-hunt POLISH / architecture item).
- Changing default tool enablement in user settings.

---

## Acceptance criteria

### Functional

- [ ] With tool enabled and `npm start`, `rag_web_content` on `https://example.com` with query `example` returns **≥ 1** numbered excerpt (not fetch error).
- [ ] On at least one CORS-blocked origin that fails in browser today, tool returns excerpts **or** a clear message to use CDP/`fetch_web_content` server path — not a generic opaque failure.
- [ ] `fetch_web_content` on the same URL succeeds whenever `rag_web_content` succeeds (shared fetch).
- [ ] Invalid args return existing errors: `Error: "url" is required` / `Error: "query" is required`.
- [ ] Query with no overlapping terms returns `No relevant sentences found …` only when page text truly has no matches (verified by test).

### Non-regression

- [ ] `wikipedia_search`, `calculate`, `get_datetime` unchanged.
- [ ] `web_search` still falls back to `web_search_ddg` when no Brave key.
- [ ] Research worker allowlist in [`sub-agents.json`](../../../src/agents/defaults/sub-agents.json) unchanged unless product adds new tool id.

### Automated

- [ ] New test file covers: mock HTML → ranked snippets; empty query terms; all-fetch-fail path returns `Error: fetch failed`.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — no new failures in sub-agent tool catalog tests.

---

## Files likely touched (implementation phase)

| File | Change |
|------|--------|
| [`src/tools/browser-executor.ts`](../../../src/tools/browser-executor.ts) | Ranking/strip improvements; possibly thin wrapper if server does fetch |
| [`src/tools/client.ts`](../../../src/tools/client.ts) | Server routing for `rag_web_content` / `fetch_web_content` |
| `server/tools/fetch-web.js` (new) or similar | Node fetch + strip + optional rank |
| [`server.js`](../../../server.js) | Register handlers |
| `test/tools/browser-executor-rag.test.mts` (new) | Deterministic ranking/fetch mocks |
| [`documentation/context.md`](../../context.md) | Web tools table + fetch path note |
| [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) | Mark BUG-015 resolved when verified |

**No prototype folder** exists in this repo; behavior is defined by shipped SPA + tool server per [`documentation/context.md`](../../context.md).

---

## Manual test plan (post-fix)

1. Settings → enable **Web RAG** and **Fetch page**.
2. Build mode: single tool call `rag_web_content` with `url` + `query` (CORS-open URL).
3. Repeat with URL that previously failed (class **A**).
4. Research mode: question requiring page excerpts; confirm **Research worker** uses `rag_web_content` when appropriate.
5. Compare excerpt quality vs raw `fetch_web_content` on same URL.

---

## Open questions (align before implementation)

1. Should server fetch be **opt-in** (setting) or automatic whenever `npm start` is up (like `web_search_ddg`)?
2. SSRF policy: block private IPs / localhost / file URLs only, or maintain an allowlist?
3. Is “no relevant sentences” acceptable for empty pages, or should the tool fall back to first N paragraphs?
4. Should BUG-015 close when only class C is fixed but class A remains on browser-only path?

---

## References

- Bug hunt: [BUG-015 section](../../bug-hunt-session-2026-05-24.md) (lines ~404–434)
- Architecture: [context.md — Built-in tools / Web / Browser executor](../../context.md)
- Research pipeline: [research-mode-perplexity-pipeline.md](../research-mode-perplexity-pipeline.md)
- Browser vs fetch: [`src/skills/browser-automation/SKILL.md`](../../../src/skills/browser-automation/SKILL.md)


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-72](https://linear.app/minnowai/issue/MIN-72/bug-015-rag-web-content-broken)
