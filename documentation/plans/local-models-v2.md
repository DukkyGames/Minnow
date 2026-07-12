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

### Phase 2 — Runtime version management (pending)

- [ ] `latestTag` + `updateAvailable` on `GET /api/models/llama-runtime`
- [ ] One-click update with version rollback
- [ ] Bump default pin past router-mode minimum
- [ ] Post-install smoke test
- [ ] Friendly OOM / driver mismatch error mapping

### Phase 3 — UX overhaul (shipped)

- [x] **Installed panel** — router card, Load/Unload/Use in chat/Launch settings, load badges
- [x] **Recommendations** — Use in chat instead of Serve
- [x] **Serve dialog** — demoted to Launch settings (`mode: 'settings'`), server-side `perModel` persistence
- [x] **Settings → Servers** — router panel instead of per-serve list
- [x] **Picker** — `llama-cpp-local` in known-local set; load/unload via provider capability
- [ ] Quoted-string parsing for `extra_args` (shell-words)
- [ ] `models-max` + lifecycle policy controls in Settings

### Phase 4 — Fit & profiles accuracy (pending)

- [ ] `server/models/gguf-meta.js` — parse GGUF headers server-side
- [ ] Partial offload suggestions from real layer counts
- [ ] Recompute catalog fit from on-disk headers

### Phase 5 — Cleanup (pending)

- [ ] Remove legacy single-serve path after one release
- [ ] Remove Ollama/LM Studio fake serve rows
- [ ] Extended UI tests for picker load-state

## Key files

| Area | Files |
|------|-------|
| Router backend | `server/models/llama-router.js`, `llama-preset.js`, `llama-args.js`, `routes.js`, `serve.js` |
| UI | `src/ui/models/installed-panel.ts`, `serve-dialog.ts`, `recommend-panel.ts`, `settings-servers-section.ts` |
| Client | `src/models/api-client.ts`, `src/api/models.ts`, `src/providers/provider-host.ts` |
| Styles | `src/styles/models-page.css` |

## Design notes

- Scene: developer at desk, switching local models without stopping a server each time.
- Restrained instrumentation: router status pill uses semantic success/warning/danger only.
- No serve dialog on happy path; Launch settings is optional per-model tuning.
