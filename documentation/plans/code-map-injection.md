# Code map injection + composer toggle

Optional per-send repo map injection into the system prompt (Brain Code index + Settings token budget), with a tri-state composer toggle (inherit / on / off) and global default `features.codeMapInjectionDefault`.

## Todos

- [x] `features.codeMapInjectionDefault` + `shouldInjectCodeMap(chat)`; `chat.codeMapInjection` on Chat + session passthrough
- [x] `ensureWarmCodeIndex`; repo-map API (`repo`, `ensureIndexed`); client `retrieveCodeMapBlock`
- [x] `code-map` prompt part, `ComposeContext`, `buildComposeContext` fetch + gating
- [x] `composer-code-map.ts`, index.html host, CSS; session sync; context usage breakdown row
- [x] Brain Code settings checkbox + settings search index
- [x] Unit/compose tests; `context.md`, `configuration.md`

## Out of scope (v1)

- Composer toggle for Brain memory injection
- Replacing `repo_map` tool or changing PageRank
- Separate inject token budget (uses Settings `repoMapTokenBudget`)
