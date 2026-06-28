# Move Memory Settings to Brain App

**Status:** Shipped (UI consolidation; no API changes).

## Summary

Moved Settings → Knowledge → Memory into the Brain app:

- **Brain → Memories** (`#/app/brain/memories`) — store enable, injection toggle, entry CRUD, backup/clear
- **Brain → Settings** — synthesis cadence, semantic embeddings (provider dropdown + Download model warmup), code index
- **Brain → Proposals** — unchanged (duplicate proposals block removed from Settings)
- Legacy `#/settings/memory` redirects to `#/app/brain/memories`
- Settings finder / `launch_minnow_app` routes `knowledge.memory*` keys to Brain

## Key files

| Area | Files |
|------|-------|
| Memories UI | `src/ui/brain/memories-section.ts`, `index.html` `#brainSection-memories` |
| Settings embeddings | `src/ui/brain/settings-section.ts` |
| Routing | `src/os/router.ts`, `src/ui/brain-memory-routing.ts`, `src/tools/os-launch-tool.ts` |
| Removed | `src/ui/settings-memory-embeddings.ts`, `src/ui/settings-memory-synthesis.ts`, `#settingsSection-memory` |

## Deep-link map

| Legacy target | New route |
|---------------|-----------|
| `#/settings/memory` | `#/app/brain/memories` |
| `knowledge.memory.enabled` / `.injection` | `#/app/brain/memories` |
| `knowledge.memory.embeddings` | `#/app/brain/settings` |
| `knowledge.memory.synthesis` | `#/app/brain/settings` |
