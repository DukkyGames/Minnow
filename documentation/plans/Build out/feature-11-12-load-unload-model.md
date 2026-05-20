---
name: Feature 11-12 — Load / unload model
overview: Topbar Load/Unload controls for LM Studio via server-proxied v1 REST endpoints; capability flags hide controls for unsupported providers; refresh models list after actions.
todos:
  - id: lm-api-research-lock
    content: Lock v1 load/unload paths and request bodies in paths.js + docs (not v0)
    status: completed
  - id: provider-capabilities
    content: Add supportsModelLoadUnload to profile/public types + seed lm-studio-local true
    status: completed
  - id: server-proxy-load-unload
    content: proxyModelLoad/proxyModelUnload + POST routes in routes.js
    status: completed
  - id: model-state-normalize
    content: isModelLoaded() helper — LM Studio uses loaded / not-loaded
    status: completed
  - id: client-api-models
    content: loadModel/unloadModel in src/api/models.ts + resolve endpoints
    status: completed
  - id: topbar-ui-buttons
    content: index.html Load/Unload buttons + topbar.css + wire main.ts handlers
    status: completed
  - id: tests-proxy-load-unload
    content: Extend test/providers/proxy-mock.test.js + client unit tests
    status: completed
  - id: verification-doc
    content: Add documentation/plans/verification/feature-11-12.md sign-off checklist
    status: completed
  - id: manual-qa-docs
    content: Manual QA with real LM Studio; update documentation/context.md on ship
    status: completed
isProject: false
---

# Feature 11-12 — Load / unload model controls + provider proxy

| Field | Value |
|-------|-------|
| **ID** | `feature-11-12-load-unload-model` |
| **Epic** | A — Topbar / models |
| **Backlog** | [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — **A3** |
| **Wave** | 7 (with A4 model-picker dots; after A2 display names) |
| **Size** | M |
| **Status** | Implemented |
| **Depends on** | **A2** (`feature-10-model-display-names`) per backlog (friendly labels); **soft** — load/unload can ship with raw `id` labels. **Coordinate:** **A1** (`.topbar-end` / `.model-wrap` layout), **A4** (dots after load/unload via `fetchModels()`) |
| **Blocks** | **A4** (`feature-12-13-model-picker-right-dots`) — dots reflect `state` after load/unload |

---

## Summary

Add **Load** and **Unload** actions beside the topbar model picker so users can load a GGUF/MLX model into LM Studio VRAM without leaving Minnow. The browser never calls upstream load/unload directly with secrets; **`npm start`** proxies `POST` to LM Studio’s **v1** REST API. Providers that cannot load/unload (e.g. generic OpenAI-compatible hosts) **hide** the buttons and show a short explanation in `title` / status.

**Critical API correction:** Backlog text references `POST /api/v0/models/load` — **LM Studio v0 REST does not expose load/unload.** Official docs:

| API | List models | Load | Unload |
|-----|-------------|------|--------|
| **v0** | `GET /api/v0/models` | — | — |
| **v1** | (separate; Minnow keeps v0 list) | `POST /api/v1/models/load` | `POST /api/v1/models/unload` |

References: [Load](https://lmstudio.ai/docs/developer/rest/load), [Unload](https://lmstudio.ai/docs/developer/rest/unload), [v0 endpoints](https://lmstudio.ai/docs/developer/rest/endpoints).

---

## Backlog alignment (A3)

| Backlog wording | Build plan decision |
|-----------------|---------------------|
| `POST /api/v0/models/load` & unload | **Use v1 paths** on same `baseUrl`; keep **v0** for `GET` models list (current `apiKind: lm-studio-v0`). |
| Button(s) beside model picker | **Ship:** `#btnLoadModel` + `#btnUnloadModel` inside `.model-wrap`, after `#modelSelect`. |
| Disable when provider lacks API | **`supportsModelLoadUnload`** on provider public profile; `openai-v1` default **false**. |
| Refresh list after action | **`await fetchModels()`** on success; spinner on buttons during request. |
| LM Studio local works; others hide | **v1:** LM Studio only for v1; optional future `lm-studio-v1` apiKind — **not** in this feature. |

**Open question (backlog § Open questions #1):** **LM Studio only** — do not attempt load/unload for arbitrary OpenAI `/v1/models` hosts. Capability flag is the extension point if another backend adds compatible endpoints later.

---

## Goals

1. **Load** the model currently selected in `#modelSelect` into LM Studio (upstream may take seconds).
2. **Unload** the selected model’s loaded instance (free VRAM).
3. **Proxy-first security** — load/unload always go through Minnow when `connectionMode: 'proxy'`; direct localhost may call upstream v1 paths without exposing secrets (no auth on typical local LM Studio).
4. **UI state** — buttons enabled/disabled from selected row `state` + capability; status pill shows progress/errors.
5. **List accuracy** — after load/unload, model `state` in dropdown/cache matches upstream (`loaded` / `not-loaded`).

---

## Non-goals

- Changing chat/completions paths (stay v0 or profile overrides).
- Load options UI (`context_length`, `flash_attention`, etc.) — send minimal body `{ model: "<id>" }` only; advanced options = future settings.
- Auto-load on model select change.
- **A4** status dots and right-aligned picker layout (separate feature).
- **A2** display-name formatting (coordinate but not required to merge first).

---

## LM Studio API research (verified)

### List models (already implemented)

- **Endpoint:** `GET /api/v0/models`
- **Minnow:** `apiKind: lm-studio-v0` → `paths.modelsPath` default `/api/v0/models`
- **Response row:** `id`, `type`, `state`, `quantization`, `arch`, `max_context_length`, …
- **State values:** `"loaded"` | `"not-loaded"` (hyphenated) per [v0 models docs](https://lmstudio.ai/docs/developer/rest/endpoints)

### Load model

- **Endpoint:** `POST /api/v1/models/load`
- **Headers:** `Content-Type: application/json`, optional `Authorization: Bearer …` (same as v0)
- **Body (minimal):**

```json
{ "model": "publisher/model-id" }
```

- **`model`** = catalog `id` from v0 list (e.g. `meta-llama-3.1-8b-instruct`).
- **Response (example):** `{ "type": "llm", "instance_id": "openai/gpt-oss-20b", "status": "loaded", "load_time_seconds": 9.099, … }`
- **Note:** `instance_id` may equal model id; unload uses this field.

### Unload model

- **Endpoint:** `POST /api/v1/models/unload`
- **Body:**

```json
{ "instance_id": "<model-id-or-instance_id>" }
```

- For v1, use selected model’s **`id`** from v0 list unless we cache `instance_id` from a prior load response (start with **`id`**; refine if QA shows mismatch).

### Version / host requirements

- LM Studio **≥ 0.3.6** for REST; v1 load/unload documented for **0.4+** line — treat **404/501** from upstream as “server too old” with clear status message.
- Requires LM Studio **local server** running (`lms server start` or GUI server tab).

---

## Problem analysis (current behavior)

### Read-only model state

[`src/api/models.ts`](../../../src/api/models.ts) populates `#modelSelect` from `fetchModelsForProvider()` and labels options with `(loaded)` / `(not loaded)` using `m.state === 'loaded'`. LM Studio returns **`not-loaded`** for unloaded rows — the **loaded** branch is correct; ensure **unload** detection uses `!isModelLoaded(m.state)` not only missing `loaded`.

### No load/unload transport

| Layer | Today |
|-------|--------|
| [`server/providers/routes.js`](../../../server/providers/routes.js) | `GET …/models`, `POST …/chat/completions` only |
| [`server/providers/proxy.js`](../../../server/providers/proxy.js) | `proxyModels`, `proxyChatCompletions` only |
| [`server/providers/paths.js`](../../../server/providers/paths.js) | v0/v1 paths for models + chat only |
| [`src/providers/resolve.ts`](../../../src/providers/resolve.ts) | `modelsUrl`, `chatUrl` only |
| [`index.html`](../../../index.html) | `#modelSelect`, `#btnRefreshModels` — no load/unload |

### OpenAI-shaped providers

[`normalizeModelsForUi`](../../../src/providers/fetch-models.ts) forces `state: 'loaded'` for `openai-v1` — load/unload buttons must be **hidden**, not no-ops, to avoid user confusion.

### Vite-only dev

Without `npm start`, proxy routes are unavailable — hide load/unload when provider list API is offline (same pattern as provider settings banner).

---

## Provider capability flags

### Schema

Extend provider **`profile.json`** and **`ProviderPublic`**:

```ts
// New optional fields (default derived when absent)
supportsModelLoadUnload?: boolean;
modelsLoadPath?: string;    // default /api/v1/models/load
modelsUnloadPath?: string;  // default /api/v1/models/unload
```

| `apiKind` | Default `supportsModelLoadUnload` | Default load/unload paths |
|-----------|-----------------------------------|---------------------------|
| `lm-studio-v0` | `true` | `/api/v1/models/load`, `/api/v1/models/unload` |
| `openai-v1` | `false` | (ignored) |

**Seed migration:** On `ensureProviderRegistry()`, set `supportsModelLoadUnload: true` on `lm-studio-local` if missing. New providers: follow table by `apiKind`; user-editable in Settings → Providers (advanced) optional — **can defer** to profile JSON manual edit in v1.

### Server runtime

[`getProviderRuntime`](../../../server/providers/store.js) should expose resolved paths:

```js
{ profile, headers, paths: { modelsPath, chatCompletionsPath, modelsLoadPath?, modelsUnloadPath? }, capabilities: { supportsModelLoadUnload } }
```

### Client

[`ProviderPublic`](../../../src/providers/types.ts) mirrors flags. Helper:

```ts
export function providerSupportsModelLoadUnload(p: ProviderPublic): boolean {
  return p.supportsModelLoadUnload === true;
}
```

---

## Proxy routes (server)

### New handlers — [`server/providers/proxy.js`](../../../server/providers/proxy.js)

| Function | Upstream | Timeout |
|----------|----------|---------|
| `proxyModelLoad(id, body)` | `POST {baseUrl}{modelsLoadPath}` | **120_000 ms** (load can be slow) |
| `proxyModelUnload(id, body)` | `POST {baseUrl}{modelsUnloadPath}` | **60_000 ms** |

- Reuse `getProviderRuntime`, `buildAuthHeaders`, JSON body forward, surface upstream status + body snippet on error (max 200 chars like `proxyModels`).
- If `!capabilities.supportsModelLoadUnload` → **400** `{ error: 'Provider does not support model load/unload' }`.

### Routes — [`server/providers/routes.js`](../../../server/providers/routes.js)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/providers/:id/models/load` | `{ model: string }` | Upstream JSON passthrough |
| `POST` | `/api/providers/:id/models/unload` | `{ instance_id: string }` | Upstream JSON passthrough |

- Validate `id` with `isSafeProviderPathSegment`.
- CORS same as existing provider routes.
- Register **before** generic 404.

### Client URL resolution — [`src/providers/resolve.ts`](../../../src/providers/resolve.ts)

Extend `ProviderEndpoints`:

```ts
modelsLoadUrl?: string;
modelsUnloadUrl?: string;
```

| `connectionMode` | Load URL |
|------------------|----------|
| `proxy` | `POST /api/providers/:id/models/load` |
| `direct` | `POST {baseUrl}/api/v1/models/load` |

Unload analogous. Only resolve when `supportsModelLoadUnload`.

---

## Client API — [`src/api/models.ts`](../../../src/api/models.ts)

### `isModelLoaded(state?: string): boolean`

```ts
return state === 'loaded';
```

Use everywhere: option labels, button disable, `nLoaded` count, default selection.

### `loadModel(modelId: string): Promise<void>`

1. Resolve active provider (`getActiveProvider(chat.providerId)`).
2. Guard capability + `modelId`.
3. `POST` with `{ model: modelId }`, `cache: 'no-store'`.
4. On non-OK → throw with status text for `setStatus('err', …)`.
5. On OK → `await fetchModels()`.

### `unloadModel(modelId: string): Promise<void>`

1. Same guards.
2. `POST` `{ instance_id: modelId }` (v0 list `id`).
3. Refresh list on success.

### UI wiring — [`src/main.ts`](../../../src/main.ts)

- `window.loadSelectedModel`, `window.unloadSelectedModel` (or module handlers bound in `initApp`).
- `updateModelLoadUnloadButtons()` called from:
  - `fetchModels()` completion
  - `onModelSelectChange()`
  - provider switch

### Button enablement matrix

| Condition | Load | Unload |
|-----------|------|--------|
| No capability | hidden or `disabled` + title “Not supported for this provider” | same |
| No model selected | disabled | disabled |
| `state === 'loaded'` | disabled | enabled |
| `state === 'not-loaded'` | enabled | disabled |
| In-flight request | disabled both | disabled both |
| `npm run dev` only (no providers API) | hidden | hidden |

---

## UI specification

### Markup — [`index.html`](../../../index.html)

Inside `.model-wrap`, after `#modelSelect`:

```html
<button type="button" id="btnLoadModel" class="icon-btn model-action-btn" …>Load</button>
<button type="button" id="btnUnloadModel" class="icon-btn model-action-btn" …>Unload</button>
```

- Prefer compact **text** buttons or small icons + `aria-label` (Load model / Unload model).
- `title` tooltips: action + disabled reason.

### Styles — [`src/styles/topbar.css`](../../../src/styles/topbar.css)

- `.model-wrap` → flex row, align center, gap `var(--space-2)`.
- `.model-action-btn` — min width, don’t shrink `#modelSelect` below existing `min-width: 10rem`.
- `mid-hide` / `≤380px`: optional hide unload/load before refresh (match backlog A1 mobile rules) — **prefer keep** with shorter labels “↑”/“↓” if cramped.

### Status pill

During load/unload: `setStatus('spin', 'Loading model…')` / `'Unloading model…'`.
Success: brief `setStatus('ok', 'Model loaded')` then normal count from `fetchModels`.
Failure: `setStatus('err', …)` with upstream hint.

**Note:** A4 removes “N models, M loaded” from status — this feature can keep count until A4 lands.

---

## Exact file change list

| File | Change |
|------|--------|
| `server/providers/paths.js` | Default v1 load/unload paths; `getProviderCapabilities(apiKind)` |
| `server/providers/proxy.js` | `proxyModelLoad`, `proxyModelUnload` |
| `server/providers/routes.js` | Two POST routes |
| `server/providers/store.js` | Profile fields, seed `supportsModelLoadUnload`, runtime paths |
| `server/providers/validate.js` | Optional validate boolean + path strings |
| `src/providers/types.ts` | New optional fields |
| `src/providers/paths.ts` | Client defaults for load/unload paths |
| `src/providers/resolve.ts` | `modelsLoadUrl`, `modelsUnloadUrl` |
| `src/api/models.ts` | `isModelLoaded`, `loadModel`, `unloadModel`, `updateModelLoadUnloadButtons` |
| `src/main.ts` | Handlers, expose on `window` if needed |
| `index.html` | Buttons in `.model-wrap` |
| `src/styles/topbar.css` | Layout for model action buttons |
| `src/window-globals.d.ts` | Optional window fn types |
| `test/providers/proxy-mock.test.js` | Mock v1 load/unload + proxy tests |
| `test/api/models-load-unload.test.mts` | **New** — `isModelLoaded`, URL resolution (mock fetch) |
| `package.json` | Wire new test files into root `npm test` script |
| `documentation/context.md` | Provider routes table + topbar behavior (on ship) |
| `documentation/plans/verification/feature-11-12.md` | Sign-off checklist (create on ship; plan-review record pre-implementation) |

**Out of scope for this PR:** `feature-10` label formatter, `feature-12-13` dots/layout.

---

## Acceptance criteria

| # | Criterion |
|---|-----------|
| AC1 | LM Studio local (`lm-studio-local`, proxy or direct): **Load** loads selected not-loaded model; dropdown shows `(loaded)` after refresh. |
| AC2 | **Unload** on loaded model; row shows not-loaded after refresh. |
| AC3 | Buttons disabled appropriately while wrong `state` or empty selection. |
| AC4 | `openai-v1` (or `supportsModelLoadUnload: false`): buttons hidden or disabled with explanation; no upstream POST attempted. |
| AC5 | Proxy mode: browser only hits `/api/providers/:id/models/load|unload`; secrets not required in client. |
| AC6 | Upstream failure (4xx/5xx, timeout) shows error status; does not corrupt `modelCache` / session. |
| AC7 | `npm test` includes new provider proxy tests; existing provider tests pass. |
| AC8 | `npm run build` exits 0. |

### Verifier sign-off

Report **PASS** only when AC1–AC8 hold, automated tests in § Test plan pass, and manual **U1–U6** in [`documentation/plans/verification/feature-11-12.md`](../verification/feature-11-12.md) are checked.

### Edge cases

| Case | Behavior |
|------|----------|
| Load already-loaded model | Load disabled; upstream error if forced — show message |
| Unload not-loaded | Unload disabled |
| VLM / embedding types in list | Filter unchanged (llm/vlm only); load only for selected id |
| Concurrent load + refresh | Disable refresh/load/unload while in-flight |
| LM Studio old version (no v1) | 404 → “Update LM Studio or enable v1 REST API” |
| Long load (60s+) | Keep spinner; respect 120s timeout |

---

## Test plan

### Automated — `npm test`

| Test file | Cases |
|-----------|--------|
| `test/providers/proxy-mock.test.js` | Mock upstream `POST /api/v1/models/load` + `unload`; assert auth headers forwarded; 400 when capability false |
| `test/api/models-load-unload.test.mts` | `isModelLoaded('loaded'/'not-loaded'/undefined)`; mock `fetch` for client `loadModel`/`unloadModel` error paths |
| `test/providers/paths.test.js` | **New optional** — default paths for `lm-studio-v0` include v1 load/unload |

### Manual QA (requires LM Studio running)

1. `npm start`, open Minnow, confirm `lm-studio-local` active.
2. Pick a **not-loaded** model → **Load** → wait → verify loaded in LM Studio UI and Minnow dropdown.
3. **Unload** → verify freed in LM Studio and `not-loaded` in list.
4. Switch provider to OpenAI-compatible remote (`openai-v1`) → buttons hidden/disabled.
5. `connectionMode: proxy` with bearer token provider → load still works (auth injected server-side).
6. Stop LM Studio → Load shows connection error, no hang past timeout.

---

## Implementation order (todos)

1. **paths + capabilities** — server/client defaults, types, seed profile.
2. **proxy + routes** — server handlers with tests.
3. **`isModelLoaded` + normalize** — fix any `nLoaded` / selection logic.
4. **Client `loadModel` / `unloadModel`** — API module + resolve URLs.
5. **Topbar UI** — HTML/CSS/handlers.
6. **Tests + manual QA** — LM Studio host.
7. **`context.md`** — on ship only.
8. **`documentation/plans/verification/feature-11-12.md`** — copy § Manual QA + acceptance checkboxes; record PASS/FAIL.

---

## Coordination with related features

| Feature | Interaction |
|---------|-------------|
| **A2** `feature-10-model-display-names` | Option text uses formatter; load/unload unchanged on `value=modelId`. |
| **A4** `feature-12-13-model-picker-right-dots` | Dots read same `state`; may remove status count text this feature still sets. |
| **A1** `feature-01-topbar-grouped-actions` | Place buttons inside grouped cluster when A1 lands. |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| v0 vs v1 path confusion | Document in plan + code comments; never call v0 for load |
| `instance_id` ≠ `id` | Log load response; cache `instance_id` on `LmModelRecord` if QA fails |
| Long blocking load | Disable send? **No** — user can still chat with already-loaded model; document |
| Direct mode CORS | LM Studio must allow browser origin — same as today’s direct models GET |

---

## References

- LM Studio REST v0 endpoints: https://lmstudio.ai/docs/developer/rest/endpoints  
- LM Studio load: https://lmstudio.ai/docs/developer/rest/load  
- LM Studio unload: https://lmstudio.ai/docs/developer/rest/unload  
- Minnow providers: [`documentation/context.md`](../../context.md) § Providers API  
- Backlog A3: [`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md)

---

## Verification artifact

After implementation, complete [`documentation/plans/verification/feature-11-12.md`](../verification/feature-11-12.md) (plan-review checklist + implementation sign-off). Pre-implementation plan review is recorded in that file § Plan review.
