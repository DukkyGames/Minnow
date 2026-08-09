# Minnow performance review (2026-08-09)

Read-only audit: budgets, production build analysis, targeted tests, and code-path review. **No product code was changed** as part of this review.

**Related:** [Boot graph + streaming plan](./minnow-performance-boot-graph-streaming.md) · [MIN-400 `budgets.json`](../../budgets.json) · [`documentation/context.md`](../context.md) (Client bootstrap)

---

## Executive summary

Minnow has substantial performance infrastructure (bundle ceilings, boot phase marks, dual-gate loader, lazy session summaries, incremental markdown, stream coalescing). The main risk today is **concentration of ~74% of eager JS in a single `store-*.js` chunk (~2.7 MB)** and a **CI budget breach** on `eagerJsMaxKb` (+10.7 KB over the 3600 KB ceiling on the reviewed build). The committed `eager-graph` test guards `src/main.ts` but **does not catch rolled-up production chunks** that still statically import CodeMirror.

| Area | Status | Severity |
|------|--------|----------|
| Eager JS budget (CI) | Fail — 3610.7 KB vs 3600 KB (+84.4 KB vs baseline) | High |
| Monolithic `store` chunk | Dominates cold-boot fetch set | High |
| CodeMirror on critical path | Static import inside `store-*.js` (~1.6 MB vendor, not in preload metric) | High |
| Hidden Bench on eager graph | ~155 KB via agent-activity → stop-all → research panel | Medium |
| `initApp()` latency | Long sequential `await` chain before first paint | Medium |
| Large chat DOM | Full history rebuild; no virtualization | Medium |
| Server sessions (SQLite) | Perf smoke tests pass | Good |
| Streaming path | Incremental markdown + throttled fanout | Good |

---

## Methodology

| Step | Command / artifact | Outcome |
|------|---------------------|---------|
| Production build | `npm run build` | Succeeded (~22–32 s locally) |
| Budget gate | `npm run check:performance-budgets` | **Eager JS breach**; other bundle metrics within limits |
| Bundle report | `node scripts/report-bundle-size.mjs --json` | Chunk breakdown recorded below |
| Boot harness | `test/boot/boot-budget-ci.test.mts` | Pass (loader dual-gate ≤ 2500 ms) |
| Eager source graph | `test/boot/eager-graph.test.mts` | Pass (no direct CM/xterm from `main.ts`) |
| Markdown streaming | `test/markdown/incremental-renderer.test.mts` | Pass (first case ~5.8 s in happy-dom) |
| Sessions SQLite | `test/config/sessions-perf.test.js` | Pass (p50 lookup &lt; 5 ms; whole blob ~128 ms for 500×200) |

**Not run:** live Electron cold boot with `MINNOW_DEBUG=1`, Lighthouse, or load tests. Use those for real `interactiveMs` and long-task correlation.

---

## Bundle metrics (reviewed build)

| Metric | Actual | Limit (`budgets.json`) | vs `scripts/bundle-size-baseline.json` |
|--------|--------|------------------------|----------------------------------------|
| Entry JS | 295.8 KB | 1500 | −14.4 KB |
| Entry CSS | 621.7 KB | 950 | −286.7 KB |
| Largest lazy JS | 2679.0 KB (`store-*.js`) | 3200 | +123.4 KB |
| **Eager JS** | **3610.7 KB (60 chunks)** | **3600** | **+84.4 KB** |
| Total assets (excl. bench data packs) | 9235.4 KB | 9500 | −33.4 KB |

### Largest assets (reference)

| Chunk | ~Size |
|-------|-------|
| `store-*.js` | 2679 KB |
| `vendor-codemirror-*.js` | 1614 KB (lazy vendor; may still load when `store` evaluates) |
| `vendor-highlight-*.js` | 989 KB |
| `index-*.css` | 622 KB |
| `catalog-*.js` | 404 KB |
| `vendor-xterm-*.js` | 334 KB |
| `index-*.js` (entry) | 296 KB |
| `benchmark-page-*.js` | 155 KB (on eager preload list) |

### Eager graph (top preloads by size)

1. `store-*.js` (~2679 KB)
2. `index-*.js` (~296 KB)
3. `benchmark-page-*.js` (~155 KB)
4. `tool-messages-*.js` (~103 KB)
5. `marked.esm-*.js` (~69 KB)
6. ~55 smaller chunks (panels, welcome, file-panel shell, compare-page, etc.)

`vendor-codemirror`, `vendor-highlight`, and `vendor-xterm` are **absent** from `rel="modulepreload"` in `dist/index.html` (Vite `modulePreload.resolveDependencies` + boot-graph work). That is correct for the **budget metric**, which only sums entry script + modulepreload hrefs.

### Budget metric vs real cold-boot bytes

The built `store-*.js` chunk contains a **top-level static import** of `vendor-codemirror-*.js`. Browsers can still download and parse **~1.6 MB additional JS** when evaluating `store`, even though CodeMirror is not listed in `index.html` preloads. Extend CI guards to the **production chunk graph**, not only `src/main.ts`.

### Other bundle notes

- **Entry CSS:** many side-effect CSS imports in [`src/main.ts`](../../src/main.ts); Vite plugin hoists stylesheet links before the entry module script.
- **Fonts:** [`src/styles/fonts.css`](../../src/styles/fonts.css) loads JetBrains Mono from Google Fonts (extra network on cold start).

---

## Client runtime

### Measurement today

- **Shell ready:** [`src/boot/app-ready.ts`](../../src/boot/app-ready.ts) — CSS sentinel `--mn-app-css-ready` + `markChromeReady`; CI harness ≤ `startup.appReadyHarnessMaxMs` (2500 ms).
- **Phases:** [`src/boot/boot-metrics.ts`](../../src/boot/boot-metrics.ts) — `shell-ready`, `sessions`, `config`, `ui-init`, `first-paint`, `interactive`.
- **Long tasks:** [`src/boot/long-task-observer.ts`](../../src/boot/long-task-observer.ts) — ≥100 ms when `MINNOW_DEBUG=1`.

CI boot budget measures **loader dismiss**, not full **`initApp()`** completion.

### `initApp()` ([`src/main.ts`](../../src/main.ts))

- **Strengths:** workspace gate overlaps work; config cluster `Promise.all`; models and Issues warm post-reveal.
- **Cost:** sequential awaits (config server, migration, tools, prompts, agents, sessions, issues, UI inits, gate, code workspace modules, `renderChatFromHistory`) before `first-paint` / gate reveal.

### Eager import chain (hidden Bench)

```
main.ts → initAgentActivityPanel()
       → chat/stop-all-agent-activity.ts → research/panel.ts
       → ui/benchmark-page.ts (static import for closeBenchmark)
```

### Chat and streaming

| Mechanism | Location | Notes |
|-----------|----------|-------|
| Incremental markdown | [`src/markdown/renderer.ts`](../../src/markdown/renderer.ts) | O(n) streaming |
| Stream activity coalesce | [`src/chat/streaming-state.ts`](../../src/chat/streaming-state.ts) | rAF batching |
| Context ring debounce | [`src/ui/context-usage-ring.ts`](../../src/ui/context-usage-ring.ts) | 200 ms composer; 1000 ms during stream |
| Outbound estimate memo | [`src/chat/prompts/token-estimate.ts`](../../src/chat/prompts/token-estimate.ts) | Tool/prompt epoch keys |
| Lazy history prefetch | [`src/ui/sidebar.ts`](../../src/ui/sidebar.ts) | `pointerenter` / `focus` |
| Assistant render debounce | [`src/constants.ts`](../../src/constants.ts) | `ASSISTANT_RENDER_DEBOUNCE_MS = 100` |
| Full transcript rebuild | [`src/ui/messages.ts`](../../src/ui/messages.ts) | `innerHTML` clear — no virtualization |

---

## Server and persistence

- Lazy session summaries and narrow SQLite queries (see [`documentation/context.md`](../context.md) — Chat, sessions).
- **`test/config/sessions-perf.test.js`:** 500 chats × 200 messages — `resolveChatWorktreeContext` p50 &lt; 5 ms; `readWholeSessionState` ~128 ms (&lt; 500 ms limit).
- Sync `execSync` / `spawnSync` on some server paths (hardware, WSL, terminal sandbox) can stall the Node event loop on first use — separate from SPA bundle size.

---

## Build and developer experience

- Production build ~22–32 s (local).
- Vite `server.watch.ignored` for `.claude/**` and `release/**` reduces dev watcher memory on Windows.
- CodeMirror `optimizeDeps.include` + editor warmup — dev stability, not production eager shrink.

---

## Prioritized recommendations (implementation backlog)

### P0 — CI green and real cold boot

1. **Split or slim eager `store-*.js`** — dynamic `import()` for chat engine, board, research shell hooks, and any path that static-imports `vendor-codemirror`.
2. **Chunk-graph CI** — fail if eager `store` (or entry transitive static deps) imports `vendor-codemirror` / full `vendor-highlight`.
3. **Remove Bench from eager graph** — dynamic import or thin `research/shell-controls` module without `benchmark-page` from [`src/chat/stop-all-agent-activity.ts`](../../src/chat/stop-all-agent-activity.ts).

### P1 — Time to interactive

4. Parallelize independent `initApp()` awaits where ordering allows.
5. Defer non–first-paint work to post-`interactive` / `requestIdleCallback`.
6. Message list virtualization (align with server offset/limit hooks in [`server/config/sessions-repo.js`](../../server/config/sessions-repo.js)).

### P2 — Polish

7. Self-host or subset fonts.
8. More route-scoped CSS (pattern used for file-panel / terminal).
9. Optional CI Electron probe for `window.__MINNOW_BOOT_METRICS__.interactiveMs`.
10. Lighten happy-dom markdown perf test fixtures for faster CI signal.

---

## Alignment with boot-graph plan

[Boot graph + streaming plan](./minnow-performance-boot-graph-streaming.md) Phases 0–6 are largely implemented (eager JS dropped from ~6448 KB to ~3526 KB historically; ceiling 3600 KB). **This review’s build exceeds that ceiling slightly** and shows **residual coupling** via the `store` chunk and CodeMirror static import. Items left “out of scope” in that plan (boot parallelization, virtualization, sync subprocess stalls) remain valid next steps.

---

## Verification checklist (when implementing fixes)

- [ ] `npm run build && npm run check:performance-budgets` — eager JS ≤ 3600 KB
- [ ] Chunk-graph test — no `vendor-codemirror` on eager/static critical path
- [ ] `test/boot/eager-graph.test.mts` — extend if Bench/compare leak via `main` graph
- [ ] Manual cold boot — `MINNOW_DEBUG=1`, compare `shell-ready` vs `interactive`
- [ ] Long chat — stream + scroll with long-task logging
- [ ] `node --test test/config/sessions-perf.test.js`

---

## Document history

| Date | Author | Notes |
|------|--------|-------|
| 2026-08-09 | Performance review (agent) | Initial read-only audit |
