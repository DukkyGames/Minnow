# Feature audit roadmap

## Context

A 22-item product wishlist was reviewed against the current Minnow build. This doc captures, per item, **what already exists** (with file pointers), **what's missing**, and a **one-line scope hint** so each can later be expanded into its own plan under [`Build out/`](Build%20out/).

**Status legend:** **Built** · **Partial** · **Missing**

---

## Gaps Worth Filling

### 1. Trace and replay infrastructure — Partial
- **Today:** Backend-owned generations ([server/generations/](../../server/generations/)) buffer streams; `chat.currentGenerationId` survives reload. Message edit/regenerate/remake exist ([src/chat/resend-from-index.ts](../../src/chat/resend-from-index.ts), [src/ui/message-actions.ts](../../src/ui/message-actions.ts)).
- **Gap:** Forkable run record (turn id → inputs, system stack, tools used, outputs); model/provider swap at the fork point and replay.
- **Scope:** New `runs/` layer parallel to `chat.history`; branch picker per message; reuse `resendFromIndex` machinery.

### 2. Per-agent model routing — Built (formalize)
- **Today:** Work agents ([src/agents/work-agent-registry.ts](../../src/agents/work-agent-registry.ts) → `~/.minnow/work-agents.json`), sub-agents ([src/agents/defaults/sub-agents.json](../../src/agents/defaults/sub-agents.json)), UI Designer ([src/agents/ui-designer/](../../src/agents/ui-designer/)), Reef widget LLM, and title jobs all carry `providerId`/`modelId`. Settings UI edits each.
- **Gap:** Consolidated routing surface — bindings are spread across four settings sections today.
- **Scope:** New `#/settings/model-routing` consolidating existing APIs; no schema changes.

### 3. Context budgets per agent — Partial
- **Today:** [src/chat/context-usage.ts](../../src/chat/context-usage.ts) + the in-chat ring (MIN-13) measure fill on the main chat. Sub-agents have `maxToolTurns`/`timeoutMs` in [src/agents/types.ts](../../src/agents/types.ts).
- **Gap:** Declared `maxInputTokens` per agent plus an enforcement policy (`summarize` / `slide` / `truncate`).
- **Scope:** New module `src/chat/context-budget.ts`; hook into `buildApiMessages` and `src/agents/sub-agent-runner.ts`.

### 4. Reef artifacts evolution — Built
- **Today:** Sandboxed iframe widgets ([src/chat/reef/](../../src/chat/reef/)), 15 templates + 6 snippets, user modules persisted at `~/.minnow/reef/modules/`.
- **Gap:** Live user-edit round-tripped to the agent; version history per artifact; tool-output → artifact pipeline; artifact-to-artifact references.
- **Scope:** Extend `widget-bridge.ts` with `editArtifact`/`subscribeEdits`; new `~/.minnow/reef/artifacts/<id>/v<n>.md` store; tool result hook.

---

## Agent Layer Polish

### 5. Interrupt and steer — Built
- **Today:** While the active chat streams, non-empty composer text **steers** (queued on `Chat.pendingSteerMessage`, consumed at each `runChatTurn` tool-loop iteration); empty composer + primary button still **stops** ([src/chat/stop-generation.ts](../../src/chat/stop-generation.ts)). Steer rows show a **Steered** chip in history.
- **Scope:** [src/chat/steer-message.ts](../../src/chat/steer-message.ts), consume in [src/tools/loop.ts](../../src/tools/loop.ts), composer routing in [src/ui/composer-send.ts](../../src/ui/composer-send.ts). Verification: [feature-05-interrupt-steer.md](verification/feature-05-interrupt-steer.md).

### 6. Approval gates with patterns — Partial
- **Today:** Per-tool `full|ask|off` ([src/tools/config.ts](../../src/tools/config.ts)); per-sub-agent allowlists; per-path filesystem gate. Approval strip ([src/ui/tool-approval-modal.ts](../../src/ui/tool-approval-modal.ts)).
- **Gap:** Per-agent override matrix; argument-pattern auto-approve (e.g. `execute_command` where `command` starts with `git status`); "always allow for this agent" sticky.
- **Scope:** Extend `ToolConfig.permissions` to `{ default, perAgent, patterns[] }`; pattern check before the existing gate.

### 7. Sub-agent budgets and structured summaries — Partial
- **Today:** `maxToolTurns`/`timeoutMs`/`maxConcurrent` per type ([src/agents/sub-agent-config.ts](../../src/agents/sub-agent-config.ts)). Aggregate JSON returned. Drawer shows raw transcript ([src/ui/sub-agent-drawer.ts](../../src/ui/sub-agent-drawer.ts)).
- **Gap:** Token budget alongside the turn budget; required structured summary schema (not raw transcript) for parent consumption.
- **Scope:** Add `maxInputTokens` + `summarySchema` to sub-agent config; child emits final `{ summary, findings[], artifacts[] }`.

### 8. Tool result caching — Built
- **Today:** [`src/tools/result-cache.ts`](../../src/tools/result-cache.ts) wraps post-gate execution in [`executeTool`](../../src/tools/client.ts) via `executeWithResultCache`; scope = workspace + chat; invalidation map for file/git writes; Settings → Tools toggle `toolCache.enabled`.
- **Plan:** [`Build out/feature-08-tool-result-cache.md`](Build%20out/feature-08-tool-result-cache.md)

---

## Local-Model-Specific

### 9. Sampler presets per agent — Missing
- **Today:** Single global temperature/maxTokens from the settings drawer; no per-agent overrides in `work-agents.json` / `sub-agents.json`.
- **Gap:** `sampler: { temperature, topP, topK, minP, repetitionPenalty }` per agent with sensible defaults per role.
- **Scope:** Extend agent schemas; merge into outgoing chat body in `streamCompletionTurn` ([src/tools/loop.ts](../../src/tools/loop.ts)).
- **Build plan:** [`Build out/feature-09-sampler-presets.md`](Build%20out/feature-09-sampler-presets.md)

### 10. Constrained decoding for tool calls — Missing
- **Today:** Native `tool_calls` only; no grammar mode. Some local models drop malformed args today.
- **Gap:** Probe provider for grammar / `response_format` support; when present, send a tool-call grammar.
- **Scope:** New `src/providers/capability-probe.ts`; opt-in path in [src/tools/loop.ts](../../src/tools/loop.ts).
- **Build plan:** [`documentation/plans/Build out/feature-10-constrained-decoding.md`](Build%20out/feature-10-constrained-decoding.md)

### 11. Model capability detection — Partial
- **Today:** Reads `context_length`, `type=vlm`, `loaded_state` from LM Studio's `/api/v0/models`. No equivalent for other providers.
- **Gap:** Active probe per provider on add/refresh; persisted capability matrix shown next to model in picker.
- **Scope:** `~/.minnow/providers/<id>/capabilities.json`; tiny probe completion on Refresh.

---

## Settings and UX

### 12. Prompt diffing — Missing
- **Today:** Custom prompt-configs per-part editor; no diff view; resetting is destructive.
- **Gap:** Side-by-side or unified diff vs the shipped default for every editable prompt; per-part reset.
- **Scope:** Pull in a small diff lib; wire into `src/ui/settings-entity-editor.ts`.
- **Plan:** [`Build out/feature-12-prompt-diffing.md`](Build%20out/feature-12-prompt-diffing.md)

### 13. Prompt versioning / profiles — Partial
- **Today:** `activePromptProfile: full|lite|custom`; custom configs are `prompt-configs/<id>.json`. No portable profile (no bundle of prompts + agents + tool selection).
- **Gap:** "Profile" = full snapshot (system prompts per part + agent bindings + tool whitelist). Export/import as a single file. Per-project default.
- **Scope:** New `~/.minnow/profiles/<id>.json`; activator overrides existing settings layers.

### 14. Cost/token observability — Partial
- **Today:** Stats strip ([src/ui/stats.ts](../../src/ui/stats.ts)) shows tok/s + TTFT. Context-usage ring. Settings prompt-token estimate ([src/ui/settings-prompt-estimate.ts](../../src/ui/settings-prompt-estimate.ts)).
- **Gap:** Per-agent rollup, per-chat totals, dollar cost for remote providers (price table per `providerId`/`modelId`).
- **Scope:** Add `pricing` block to provider profile; `chat.tokenLedger`; new `#/settings/usage` panel.
- **Plan:** [`Build out/feature-14-cost-token-observability.md`](Build%20out/feature-14-cost-token-observability.md)

### 15. Agent activity view — Built
- **Shipped:** Global panel ([`src/ui/agent-activity-panel.ts`](../src/ui/agent-activity-panel.ts), [`src/state/agent-activity-registry.ts`](../src/state/agent-activity-registry.ts)) lists main turns, sub-agents, title jobs, and Reef widget LLM across all chats. Toggle **`#btnAgentActivity`** in the chat sidebar footer (`minnow.agentActivityOpen` in `localStorage`). Event buses: [`main-turn-activity.ts`](../src/chat/main-turn-activity.ts), [`sub-agent-events.ts`](../src/agents/sub-agent-events.ts), [`titles/activity-events.ts`](../src/chat/titles/activity-events.ts), [`reef/activity-events.ts`](../src/chat/reef/activity-events.ts). Sub-agent rows expose `liveCurrentToolName` on [`SubAgentRun`](../src/agents/types.ts). Tests: `test/state/agent-activity-registry.test.mts`, `test/ui/agent-activity-panel.test.mts`, `test/agents/orchestrator-live-tool.test.mts`. Plan: [`feature-15-agent-activity-view.md`](Build%20out/feature-15-agent-activity-view.md).

---

## Open-Source Hygiene

### 16. Plugin API for agents — Partial
- **Today:** Built-in agent dirs + user override path (`~/.minnow/prompts/work-agents/<id>/`, `~/.minnow/work-agents.json`). No package install path; no plugin manifest.
- **Gap:** Drop-in agent pack = folder under `~/.minnow/agent-packs/<name>/` with manifest declaring system prompt, tool subset, model binding, context strategy. Loader merge + settings UI.
- **Scope:** Define `agent-pack.schema.json`; new loader at `src/agents/pack-loader.ts`; share dir convention.

### 17. Plugin API for tools — Partial
- **Today:** MCP supported (Context7 built-in, custom add) ([server/mcp/](../../server/mcp/)). Native tool catalog is repo-internal ([src/tools/definitions.ts](../../src/tools/definitions.ts)).
- **Gap:** Native local tool plugin path that doesn't require an MCP server — local JS module under `~/.minnow/tools/<name>/{tool.json,handler.mjs}` loaded by `server/tools/loader.js`.
- **Scope:** Mirror the skills loader pattern; sandbox via vm if needed.
- **Build plan:** [`Build out/feature-17-tool-plugin.md`](Build%20out/feature-17-tool-plugin.md)

### 18. Headless mode — Missing
- **Today:** All flows go through the SPA. `server.js` exposes HTTP but no CLI front-end.
- **Gap:** `minnow run --agent builder --prompt "…"` that drives the same backend (generations, sub-agents, tools) and returns final transcript JSON. Suitable for CI.
- **Scope:** New `bin/minnow.mjs`; talks to localhost generations API; supports `--workspace`, `--profile`, `--no-approval` (with safety opt-in).

### 19. Determinism mode for testing — Missing
- **Today:** Unit tests in `test/`; no integration recording.
- **Gap:** `MINNOW_RECORD=1` snapshots tool responses + LLM streams; `MINNOW_REPLAY=1` plays them back; seed pinning forwarded to provider when supported.
- **Scope:** New `src/testing/record-replay.ts`; intercept layer in `executeTool` + `streamCompletionTurn`; snapshot files under `test/snapshots/`.

---

## Differentiators

### 20. Multi-model conversation — Missing
- **Today:** Orchestrate spawns sub-agents serially; no in-chat critic ↔ proposer loop with distinct system prompts side-by-side.
- **Gap:** New mode (or Reef-style widget) where two named agents take turns, visible as distinct bubbles, with optional human arbiter step.
- **Scope:** Builds on the existing sub-agent runner; new `multi-model` mode prompt + UI bubble lane.
- **Build plan:** [`Build out/feature-20-multi-model-conversation.md`](Build%20out/feature-20-multi-model-conversation.md)

### 21. Local eval harness — Missing
- **Today:** No user-defined task pack or model comparison runner.
- **Gap:** User declares N tasks (prompt + tool whitelist + grading rubric prompt) → run across N models → leaderboard. Stored under `~/.minnow/evals/`.
- **Scope:** New `src/evals/` runner reusing sub-agent isolation; results panel in settings.
- **Plan:** [`documentation/plans/Build out/feature-21-local-eval-harness.md`](Build%20out/feature-21-local-eval-harness.md)

### 22. Project-scoped everything — Partial
- **Today:** Workspace-scoped *chats* (B2) and recent menu. Agent configs, prompts, tool whitelist, MCP servers, model bindings are still **global** in `~/.minnow/`.
- **Gap:** `.minnow/` inside the workspace overrides global; git-friendly; auto-detected by workspace path.
- **Scope:** New resolver layer (workspace `.minnow/` → user `~/.minnow/` → built-in defaults). Touches every config loader.

---

## Suggested sequencing

1. **Quick wins:** #2 model routing UI, #6 auto-approve patterns, #9 sampler presets, #14 cost/usage panel.
2. **Foundational (do before profiles/packs):** #22 project-scoped configs.
3. **Strategic differentiators:** #1 trace/replay, #4 Reef artifact evolution.
4. **Quality/scale:** #19 determinism, #18 headless, #21 eval harness.

---

Each item above will be expanded into its own plan under [`documentation/plans/Build out/`](Build%20out/) when picked up.
