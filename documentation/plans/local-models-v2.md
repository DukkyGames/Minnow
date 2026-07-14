# Local models v2 — llama.cpp router mode (MIN-380)

Linear: [MIN-380](https://linear.app/minnowai/issue/MIN-380/local-models-v2-rebuild-llamacpp-serving-on-upstream-router-mode-multi)

## Summary

Rebuild local GGUF serving around upstream **llama-server router mode**: one persistent router process, auto-load on pick, LRU eviction, per-model preset INI. Removes the per-model serve dance.

## Phases

### Phase 1 — Router process manager (shipped)

- [x] `server/models/llama-router.js` — singleton start/stop/restart, crash backoff, `router-state.json`
- [x] `server/models/llama-preset.js` — `writeLlamaPresetIni()` from `llama-cpp.json` + installed artifacts
- [x] `buildLlamaRouterArgs()` in `llama-args.js` (no `-m`)
- [x] API: `GET/POST /api/models/router/*`, `POST /api/models/load|unload`
- [x] `llama-cpp-local` provider: `supportsModelLoadUnload: true`
- [x] Boot reconcile in `bootstrapMinnowRuntime()`
- [x] Tests: `test/models/llama-router.test.mjs`

### Phase 2 — Runtime version management (shipped)

- [x] `latestTag` + `updateAvailable` on `GET /api/models/llama-runtime`
- [x] One-click update with version rollback (`POST /api/models/llama-runtime/rollback`)
- [x] Pinned tag `b9628` (router-mode minimum); update fetches GitHub latest
- [x] Post-install smoke test (`probeLlamaRouterSupport`)
- [x] Friendly OOM / driver mismatch error mapping (`server/models/llama-errors.js`)

### Phase 3 — UX overhaul (shipped)

- [x] **Installed panel** — router card, Load/Unload/Use in chat/Launch settings, load badges
- [x] **Recommendations** — Use in chat instead of Serve
- [x] **Serve dialog** — demoted to Launch settings (`mode: 'settings'`), server-side `perModel` persistence
- [x] **Settings → Servers** — router panel instead of per-serve list
- [x] **Picker** — `llama-cpp-local` in known-local set; load/unload via provider capability
- [x] Quoted-string parsing for `extra_args` (`server/models/shell-words.js`, `src/utils/shell-words.ts`)
- [x] `models-max` + lifecycle policy controls in Settings (`router.lifecycle`: off / on-demand / always)

### Phase 4 — Fit & profiles accuracy (shipped)

- [x] `server/models/gguf-meta.js` — parse GGUF headers server-side
- [x] Partial offload suggestions from real layer counts (`suggestGpuLayers` in `profiles.js`)
- [x] Recompute catalog fit from on-disk headers (`installed.js`, `GET /api/models/profiles?gguf_path=`)

### Phase 5 — Cleanup (shipped)

- [x] Remove legacy single-serve path (router required; upgrade prompt when unsupported)
- [x] Remove Ollama/LM Studio fake serve rows and Installed panel buttons
- [x] Extended UI tests (`settings-servers-section-llama.test.mts`, shell-words, gguf-meta, profiles-offload)

## Key files

| Area | Files |
|------|-------|
| Router backend | `server/models/llama-router.js`, `llama-preset.js`, `llama-args.js`, `routes.js`, `serve.js` |
| Runtime | `server/models/llama-runtime.js`, `llama-errors.js`, `llama-variant.js` |
| Fit | `server/models/gguf-meta.js`, `profiles.js`, `installed.js` |
| UI | `src/ui/models/installed-panel.ts`, `serve-dialog.ts`, `recommend-panel.ts`, `settings-servers-section.ts` |
| Client | `src/models/api-client.ts`, `src/api/models.ts`, `src/providers/provider-host.ts` |
| Styles | `src/styles/models-page.css` |

## Design notes

- Scene: developer at desk, switching local models without stopping a server each time.
- Restrained instrumentation: router status pill uses semantic success/warning/danger only.
- No serve dialog on happy path; Launch settings is optional per-model tuning.
- Router lifecycle `always` auto-starts the router on `npm start` when a capable binary is installed.
