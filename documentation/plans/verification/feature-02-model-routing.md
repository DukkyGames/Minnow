# Feature 02 — Model routing verification

Manual checklist for `#/settings/model-routing` (consolidated per-role bindings).

## Prerequisites

- `npm start` (config + tool server)
- At least one provider configured under Settings → Providers
- Two chats with different models (for Reef per-chat test)

## Checks

1. Open Settings → **Model routing** — work agents, sub-agent types, background (UI Designer + titles), and Reef groups load without errors.
2. **Work agent:** Set builder to provider A / model X → Save → reload section → values persist; optional: send as builder and confirm generation uses X.
3. **Sub-agent:** Set explore model to empty → effective line shows active chat model; set a dedicated model → Save → persists.
4. **UI Designer:** Set dedicated provider/model → Save → `/ui-designer` uses that model (or toggle fallback and confirm chat default).
5. **Titles:** Set titles model → Save → new chat first message renames sidebar (when titles enabled).
6. **Reef:** On chat A set widget model → switch to chat B in sidebar → Model routing Reef row shows B’s values when section is open.
7. **Offline:** `npm run dev` only → banner; no false “saved” toasts when saving.
8. **Deep links:** Each row **Advanced…** opens work-agents, sub-agents, or modes hash as labeled.

## Automated

- `npx tsx --test test/settings/model-routing-catalog.test.mts`
- `node --test test/ui/settings-model-routing.test.mjs`
- `npx tsc --noEmit`
