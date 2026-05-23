# Feature #15 — Agent activity view (verification)

**Roadmap:** §15 **Built**  
**Plan:** [`../Build out/feature-15-agent-activity-view.md`](../Build%20out/feature-15-agent-activity-view.md)

## Acceptance checklist

- [ ] **Toggle** `#btnAgentActivity` in chat sidebar footer opens/closes panel; preference `minnow.agentActivityOpen` persists.
- [ ] **Empty state** when no workers are active.
- [ ] **Main turn** row during streaming or when `currentGenerationId` is set; shows work-agent label, model, phase, optional tool name, elapsed.
- [ ] **Sub-agent** rows for all `listActiveSubAgentRuns()` across chats; current tool from `liveCurrentToolName`; click opens sub-agent drawer.
- [ ] **Title job** row during first-message rename (`Naming chat`).
- [ ] **Reef widget LLM** rows (max 2 concurrent) with widget id + model.
- [ ] **Cross-chat** stream in chat A remains visible after switching to chat B.
- [ ] **Elapsed** updates about every second while panel is open.
- [ ] **Context fill** mini-bar on main rows when budget is known; sub-agent rows show no bar (estimate tooltip deferred).
- [ ] **a11y** `role="region"` / `aria-label="Agent activity"`; list items keyboard-activatable; Escape closes panel.

## Automated tests

```bash
node --experimental-test-module-mocks ./node_modules/tsx/dist/cli.mjs --import ./test/test-loader.mjs --test \
  test/state/agent-activity-registry.test.mts \
  test/ui/agent-activity-panel.test.mts \
  test/agents/orchestrator-live-tool.test.mts
```

## Manual smoke

1. Build mode: send a message that invokes tools → main row shows updating tool names.
2. Spawn explore sub-agent → row appears; switch chat → row remains; click → drawer opens.
3. Orchestrate board view: sub-agent still listed when inline cards are hidden.
4. Reef widget `callLLM` → widget rows (cap at 2).
5. New chat first message → brief title row.
6. Reload mid-generation → main row after boot resume.
