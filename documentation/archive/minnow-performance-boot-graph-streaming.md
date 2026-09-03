# Minnow Performance: Boot Graph + Streaming

## Status

Implemented in worktree `boot-stream-perf-e8cf126b` (awaiting `/apply-worktree`).

## Todos

- [x] Phase 0 — Measurement first (boot phase marks, long-task correlate, `eagerJsMaxKb`, fix CI sentinel)
- [x] Phase 1 — Evict CodeMirror from the boot graph (~1,614 KB)
- [x] Phase 2 — highlight.js core build (~750 KB)
- [x] Phase 3 — Lazy model catalog (~505 KB)
- [x] Phase 4 — Kill the stale-session flash on switch
- [x] Phase 5 — Incremental markdown render (O(n²) → O(n))
- [x] Phase 6 — Throttle the per-token fanout (context estimate memo, board rAF coalesce, thought join cache)
- [x] Verify: `tsc`, build, performance budgets; update `documentation/context.md`

## Measured outcome (after Phases 0–3)

| Metric | Before | After |
|---|---|---|
| Eager JS (`eagerJsMaxKb`) | 6,448 KB | **3,526 KB** (−45%) |
| `vendor-codemirror` in `dist/index.html` | modulepreloaded | **0** |
| `vendor-highlight` in `dist/index.html` | modulepreloaded | **0** |

Budget ceiling ratcheted to `eagerJsMaxKb: 3600`.

## Targeted symptoms

| Symptom | Addressed by |
|---|---|
| Slow cold start | Phases 1–3 |
| Stale session flash on app/workspace switch | Phase 4 |
| Jank while streaming | Phase 5 |
| Freezes on large chats/boards | Phase 6.2 |

## Phase 0 — Measurement first

Extend MIN-400. Keep everything `MINNOW_DEBUG=1` gated with no telemetry.

### 0.1 Phase marks

Extend `src/boot/boot-metrics.ts`:

```ts
export type BootPhase = 'shell-ready' | 'sessions' | 'config' | 'ui-init' | 'first-paint' | 'interactive';
export function markBootPhase(phase: BootPhase): void;
export function measureBootPhase(name: string, from: BootPhase, to: BootPhase): void;
```

Instrument `startApp()` entry, `main.ts` after `Promise.all`, `initApp()` entry, config cluster, after `renderChatFromHistory`, and `initApp()` exit. Record `interactiveMs`. Extend `logBootMetricsIfDebug` to print a phase table.

### 0.2 Correlate long tasks

On each long task in `long-task-observer.ts`, read overlapping `performance.getEntriesByType('measure')` and print the enclosing phase.

### 0.3 A budget that can actually fail

Add `bundle.eagerJsMaxKb`, computed by parsing `dist/index.html` for the entry `<script type="module">` plus every `rel="modulepreload"` href and summing. Seed ceiling at today's **6448 KB**. Fix `test/boot/boot-budget-ci.test.mts` so it stops pre-applying the CSS sentinel before the timer starts.

## Phase 1 — Evict CodeMirror from the boot graph

Split CodeMirror-free helpers into:

1. `src/ui/editor-ai-binding.ts` — binding helpers / constants / types
2. `src/ui/editor-completion-transport.ts` — `completionCacheTransportMode`

Point eager importers at the new modules. Add `test/boot/eager-graph.test.mts` regression guard.

## Phase 2 — highlight.js core build

Create `src/markdown/highlighter.ts` on `highlight.js/lib/core` with ~30 registered languages; lazy-import full bundle for unregistered langs. Move `refreshHljsInDocument` here.

## Phase 3 — Lazy model catalog

Change `getModels()` to `Promise<CatalogModel[]>` via `await import('./catalog.json')`.

## Phase 4 — Kill the stale-session flash

1. Paint transition/skeleton synchronously after `activeId` flip
2. Fast path when `historyLoaded !== false`
3. Prefetch on sidebar `pointerenter`/focus

Apply same treatment to `activateChatById`.

## Phase 5 — Incremental markdown render

Per-bubble `WeakMap` state with token signatures (FNV-1a), dirty-from index, append-only DOM. Per-bubble debounce. Hoist announcer rate-limit above `summarizeProse`.

## Phase 6 — Throttle per-token fanout

1. Memoize composed-system + tools estimate; raise streaming debounce 200→1000 ms
2. Coalesce `notifyChatStreamActivity` with rAF/microtask batch by `chatId`
3. Cache thought-controller joined display text

## Explicitly out of scope

Boot await parallelization, Windows execSync stalls, list virtualization, server-side algorithmic wins, threading, React conversion, app-code `manualChunks` as the primary fix, raising budget ceilings, lowering `ASSISTANT_RENDER_DEBOUNCE_MS` before Phase 5, deleting hidden-app code.

## Verification

```bash
npx tsc --noEmit && npm run build && npm run check:performance-budgets
```

Targeted: `npm test -- --suite board`, `test/boot/eager-graph.test.mts`, Phase 5 markdown tests.

## Expected outcome

| Metric | Now | After |
|---|---|---|
| Eager JS | 6,448 KB | ~3,850 KB (−40%) |
| Streaming render | O(n²) | O(n) |
| `buildComposeContext` per stream | ~5/sec | ~1 total |
| Stale-content flash on switch | every cold chat | none |
