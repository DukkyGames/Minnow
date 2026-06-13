# Odysseus Port 03 — Blind A/B Model Compare

Tier: 1  
Effort: M  
Priority: High  
Status: Planned  
Linear: [MIN-119](https://linear.app/minnowai/issue/MIN-119/odysseus-port-03-blind-ab-model-compare)

## Goal

Add an interactive blind model-comparison app where one prompt streams responses from two selected models, hides model identities until the user votes, and persists preference history. This complements the automated Benchmark app with human preference data.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | None |
| npm packages | None |
| External binaries | Two configured providers/models for manual QA |
| Credentials | Provider secrets (existing plaintext or #12 encrypted) |
| Estimated effort | 4–6 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| MinnowOS `compare` app | Hash route `#/app/compare`, UI page |
| Server blind sessions | `server/compare/` with mapping held server-side |
| Dual streaming | Two independent generation streams with opaque ids |
| Vote + reveal | Persist preference, then show model identities |
| History + win rates | Local persistence under `~/.minnow/compare/` |
| Tests | Redaction, randomization, double-vote prevention |

## Verified Source Context

- Odysseus reference: `routes/compare_routes.py`.
  - Endpoints: `POST /api/compare/start`, `POST /api/compare/{id}/vote`, `GET /api/compare/history`, `DELETE /api/compare/{id}`.
  - Blind mapping: `{"left": "a"|"b", "right": "a"|"b"}` stored server-side.
  - ORM `Comparison` model with `model_a/b`, `endpoint_a/b`, `blind_mapping`, `winner`.
- Minnow generations client: `src/api/generations.ts`.
- Minnow SSE parser: `src/api/sse-parse.ts`.
- Benchmark persistence template: `src/benchmark/persistence.ts`.
- Server middleware registration: `server/runtime/middlewares.js`.
- MinnowOS app ids are closed in `src/os/types.ts`; adding `compare` requires updating the union.
- App registration pattern: `src/os/app-registry.ts`, `src/os/app-host.ts`, `index.html`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/compare/store.js` | Session + history persistence |
| `server/compare/routes.js` | Blind session, vote, history APIs |
| `server/compare/middleware.js` | Connect middleware wrapper |
| `src/compare/persistence.ts` | Client-side history mirror (benchmark pattern) |
| `src/ui/compare-page.ts` | Full Compare UI |
| `src/styles/compare.css` | Compare-specific styles |
| `test/compare/blind-session.test.mjs` | Server redaction + mapping tests |
| `test/compare/persistence.test.mjs` | Vote persistence tests |
| `test/os/compare-app.test.mts` | App registration + markup contract |

## Files to Modify

| Path | Change |
|------|--------|
| `src/os/types.ts` | Add `'compare'` to `AppId` union |
| `src/os/app-registry.ts` | Register Compare app tile |
| `src/os/app-host.ts` | Add `compare` to `APP_LAYER_IDS`, `openAppPage()` |
| `src/os/icons.ts` | Compare app icon (if new glyph needed) |
| `index.html` | Add `#compareView` app layer + dock tile |
| `server/runtime/middlewares.js` | Register `createCompareMiddleware()` |
| `documentation/context.md` | Document Compare app |

## Data Model

```ts
interface CompareSession {
  id: string;
  startedAt: string;
  prompt: string;
  leftGenerationId: string;
  rightGenerationId: string;
  leftAlias: 'A' | 'B';
  rightAlias: 'A' | 'B';
  // Server-only until vote:
  left: { providerId: string; modelId: string };
  right: { providerId: string; modelId: string };
  voted: boolean;
  winner?: 'left' | 'right' | 'tie' | 'both_bad';
  notes?: string;
  completedAt?: string;
}

interface CompareVote {
  id: string;
  startedAt: string;
  completedAt: string;
  prompt: string;
  left: { providerId: string; modelId: string };
  right: { providerId: string; modelId: string };
  assignment: { leftAlias: 'A' | 'B'; rightAlias: 'A' | 'B' };
  winner: 'left' | 'right' | 'tie' | 'both_bad';
  revealed: boolean;
  notes?: string;
}
```

Store provider id and model id separately for each side. Do not store bare model ids because Minnow model selections are provider-scoped composite keys.

Persistence root: `~/.minnow/compare/sessions.json` + `~/.minnow/compare/history.json`.

## API Routes

| Method | Path | Request | Response (pre-vote) |
|--------|------|---------|---------------------|
| POST | `/api/compare/start` | `{ prompt, left: {providerId, modelId}, right: {providerId, modelId}, sampler? }` | `{ sessionId, left: { generationId, label: 'A'\|'B' }, right: { generationId, label: 'A'\|'B' } }` — **no provider/model ids** |
| GET | `/api/compare/:id/stream/:side` | — | SSE stream for opaque generation (or reuse generations subscribe with redacted metadata) |
| POST | `/api/compare/:id/vote` | `{ winner: 'left'\|'right'\|'tie'\|'both_bad', notes? }` | `{ revealed: true, left: {providerId, modelId}, right: {...}, winner }` |
| GET | `/api/compare/history` | `?limit=50` | Array of `CompareVote` (revealed only) |
| DELETE | `/api/compare/:id` | — | `{ ok: true }` |

## Detailed Implementation Phases

### Phase 1 — App shell (1 day)

1. Add `'compare'` to `AppId` in `src/os/types.ts`.
2. Register in `src/os/app-registry.ts` (label, description, icon, hash route).
3. Add `#compareView` markup to `index.html` (prompt input, two columns, vote bar, history panel).
4. Wire `src/os/app-host.ts`: `APP_LAYER_IDS`, `openAppPage('compare')`.
5. Create `src/ui/compare-page.ts` skeleton: mount on app open, unmount on close.
6. Add `src/styles/compare.css`; import from compare-page or main.
7. Test: app opens from dock, hash `#/app/compare` works.

### Phase 2 — Server blind sessions (1.5 days)

1. Create `server/compare/store.js`:
   - `createSession(prompt, left, right)` — randomize A/B column assignment.
   - `getSession(id)` — return redacted or full based on `voted` flag.
   - `recordVote(id, winner, notes)` — persist to history, mark revealed.
   - `listHistory(limit)` — revealed votes only.
2. Create `server/compare/routes.js`:
   - `POST /start`: start two generations via internal generations API (`persist: false` or compare-scoped).
   - Store mapping server-side; return only opaque `generationId` + column label.
3. Register middleware in `server/runtime/middlewares.js`.
4. Tests: mapping randomization, pre-vote responses contain no model ids, double-vote rejected.

### Phase 3 — Model selection UI (0.5 day)

1. Reuse model picker from Benchmark (`src/ui/bench-page.ts` or `model-select-picker.ts`).
2. Two independent pickers: Left model, Right model.
3. Require both before Run; allow same provider, different models.
4. Show composite key internally; never show in column headers pre-vote.

### Phase 4 — Dual streaming (1.5 days)

1. On submit → `POST /api/compare/start`.
2. Subscribe to both generation streams (reuse `src/api/generations.ts` subscribe with opaque ids).
3. Parse SSE via `src/api/sse-parse.ts` independently per column.
4. UI per column: loading spinner, streaming text, stop button, error state.
5. **Redaction checklist** (verify in tests + manual network inspect):
   - [ ] Column headers show only "A" / "B" or "Left" / "Right"
   - [ ] Generation metadata API responses omit provider/model pre-vote
   - [ ] History API omits unrevealed sessions
   - [ ] DOM `data-*` attributes contain no model ids
   - [ ] Stats/token labels do not leak model names
6. One column failure must not cancel the other.

### Phase 5 — Voting, reveal, history (1 day)

1. Vote buttons: Left wins, Right wins, Tie, Both bad.
2. Enable vote when both streams complete OR user stops both.
3. `POST /api/compare/:id/vote` → reveal model names in UI.
4. Append to history list (newest first).
5. Win-rate aggregation: group by `providerId:modelId` composite key.
6. `src/compare/persistence.ts`: localStorage fallback when server offline.
7. Tests: win-rate math with fixed fixtures, persistence merge.

## Implementation TODOs

- [ ] Add `compare` to `src/os/types.ts`
- [ ] Register the app in `src/os/app-registry.ts`
- [ ] Add a `compareView` app layer to `index.html`
- [ ] Add `compare` to `APP_LAYER_IDS` and `openAppPage()` in `src/os/app-host.ts`
- [ ] Build `src/ui/compare-page.ts` with prompt field, two model pickers, two streamed response panes, vote controls, and history
- [ ] Build `src/compare/persistence.ts` using the benchmark persistence pattern
- [ ] Build `server/compare/` persistence routes
- [ ] Build server-side blind session mapping and reveal-on-vote behavior
- [ ] Add tests for randomization, redaction, double-vote prevention, persistence merge, and win-rate aggregation
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_compare_endpoint_owner_scope.py` | Adapt — Minnow is single-user local |
| `tests/test_endpoint_owner_scope_followup.py` | Redaction regression spirit |

## Acceptance Criteria

- Compare app launches from MinnowOS.
- Two model pickers populate from existing provider catalogs.
- One prompt streams two independent responses.
- Model identities stay hidden until vote.
- Model identities are not present in blind session API responses before vote.
- One column failure does not erase the other column.
- Votes persist across reloads and aggregate into win rates.

## Verification

- Add UI/source-contract tests for app registration and markup.
- Add persistence tests similar to benchmark history tests.
- Port the spirit of Odysseus blind-compare redaction tests.
- Manual: run one prompt against two models, vote, reload, and verify history remains.
- Manual: inspect pre-vote DOM/network payloads and confirm model ids are not exposed.
- Manual: stop or break one provider and verify the other column remains usable.

## Risks And Guardrails

- Do not reuse Benchmark run models directly if it forces automated scoring semantics into human preference data.
- Do not fail both columns when one provider errors.
- Keep randomized assignment server-side until vote to preserve blindness.
- V1 is chat-only with tools disabled unless a later phase explicitly ports Odysseus agent/research compare modes.
