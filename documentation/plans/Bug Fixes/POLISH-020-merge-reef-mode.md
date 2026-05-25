# POLISH-020 — Merge Reef into General + Research (drop Reef mode)

| Field | Value |
| --- | --- |
| **ID** | POLISH-020 |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) § POLISH-020 |
| **Status** | Plan only (no implementation in this item) |
| **Depends on** | **POLISH-019** — General/Chat composer mode ([`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) § POLISH-019). Ship General first, or land both in one coordinated change. |
| **Related** | Reef widget pipeline (unchanged shell), mode handoff ([`src/chat/prompts/tool-usage/mode-handoff.md`](../../../src/chat/prompts/tool-usage/mode-handoff.md)), Feature #04 artifacts ([`documentation/plans/Build out/feature-04-reef-artifacts.md`](../Build%20out/feature-04-reef-artifacts.md)) |

---

## Goal

**Reef** (inline ` ```reef-widget ` artifacts) should not be a **standalone composer mode**. Widget authoring and guidance move into **General/Chat** and **Research**; the **Reef** segment disappears from the mode picker. The **widget runtime** (`src/chat/reef/`), template library, `reef-widget` sub-agent, and per-chat widget LLM bindings **remain**.

After merge, primary composer modes become: **Build**, **Plan**, **Orchestrate**, **Research**, **General** (five modes, Reef replaced by General — not “four + General” as a sixth on top of Reef).

---

## Product summary

| Today | Target |
| --- | --- |
| User picks **Reef** to build interactive UI in chat | User stays in **General** or **Research** (or uses handoff from Build/Plan/Orchestrate) |
| `modes/reef.{full,lite}.md` is the authoring contract | Reef rules split into **General** (conversational widgets) and **Research** (deliverable charts/tables) supplements |
| Handoff offers “switch to Reef” for editing | Handoff spawns **`reef-widget`** sub-agent and posts fence **without** mode switch unless user explicitly wants General for iteration |
| Settings → Modes → **Reef** for widget LLM | Settings under **General** and/or **Research** (or shared “Widget LLM” block visible in both) |
| Persisted `Chat.modeId: 'reef'` | Migrate on load → **`general`** (default) or **`research`** (product rule below) |

---

## Current state (relevant code)

### Mode registry

- Five primaries in [`src/chat/modes/registry.ts`](../../../src/chat/modes/registry.ts): `build`, `plan`, `orchestrate`, `research`, `reef`.
- [`src/chat/modes/types.ts`](../../../src/chat/modes/types.ts): `ModeId` includes `reef`; legacy `debug` already maps to `build` in `normalizeModeId()`.
- Server mirror: [`server/config/validators.js`](../../../server/config/validators.js) `MODE_IDS`.

### UI

- Mode picker built from `listModes()` in [`src/ui/mode-selector.ts`](../../../src/ui/mode-selector.ts) (`#modeSelector` in [`index.html`](../../../index.html)).
- Reef widget LLM: [`src/ui/reef-widget-settings.ts`](../../../src/ui/reef-widget-settings.ts), mounted when `id === 'reef'` in [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) `renderModesSection()`.
- Model routing row group `'reef'`: [`src/settings/model-routing-catalog.ts`](../../../src/settings/model-routing-catalog.ts), [`src/ui/settings-model-routing.ts`](../../../src/ui/settings-model-routing.ts).

### Prompts

- Authoring contract: [`src/chat/prompts/modes/reef.full.md`](../../../src/chat/prompts/modes/reef.full.md) (+ `reef.lite.md`) — templates table, snippets, `check_reef_widget`, user modules, design tokens.
- Mode handoff: [`src/chat/prompts/tool-usage/mode-handoff.md`](../../../src/chat/prompts/tool-usage/mode-handoff.md) — “switch to Reef only if user wants to keep editing widgets”.
- Build already delegates visualization via sub-agent: [`src/chat/prompts/modes/build.full.md`](../../../src/chat/prompts/modes/build.full.md) L60.
- Research **forbids** `reef-widget` sub-agent today: [`src/chat/prompts/modes/research.full.md`](../../../src/chat/prompts/modes/research.full.md) L53.

### Widget pipeline (keep)

- Mount is **mode-agnostic** for display: [`src/chat/reef/widget-block-detector.ts`](../../../src/chat/reef/widget-block-detector.ts) (comment: only Reef should **author**).
- [`src/markdown/renderer.ts`](../../../src/markdown/renderer.ts) passes `modeId` into `mountReefWidgets()`.
- Sub-agent `reef-widget` unchanged: [`src/agents/prompts/sub-agents/reef-widget.full.md`](../../../src/agents/prompts/sub-agents/reef-widget.full.md), [`src/agents/defaults/sub-agents.json`](../../../src/agents/defaults/sub-agents.json).
- Tools: `check_reef_widget`, `@minnow/reef/widgets/`, `~/.minnow/reef/modules/`.

### Handoff tools

- [`src/tools/mode-handoff-tools.ts`](../../../src/tools/mode-handoff-tools.ts): `HANDOFF_MODES` includes `reef`; `reef_visualization` preset description says “switch to Reef”.
- [`src/tools/definitions.ts`](../../../src/tools/definitions.ts): `set_chat_mode` / `create_chat_with_mode` enums list `reef`.
- [`src/chat/prompts/prompt-composer.ts`](../../../src/chat/prompts/prompt-composer.ts): `MODE_HANDOFF_MODE_IDS` includes `reef`.

### Tests / benchmarks

- Mode count and prompt paths: [`test/modes/*.mts`](../../../test/modes/), [`test/modes/test-helpers.mts`](../../../test/modes/test-helpers.mts).
- Reef mount tests often set `chat.modeId = 'reef'`: [`test/chat/reef/widget-block-detector.test.mts`](../../../test/chat/reef/widget-block-detector.test.mts).
- Benchmark modes suite: [`src/benchmark/suites/modes.ts`](../../../src/benchmark/suites/modes.ts) `reef` positive probe.

### Docs

- [`README.md`](../../../README.md), [`AGENTS.md`](../../../AGENTS.md), [`documentation/context.md`](../../context.md) — “five modes” including Reef.

---

## Target behavior

### Mode picker

- **Remove** `reef` from `MODE_DEFINITIONS` and from `listModes()` order.
- **Add** `general` per POLISH-019 (label TBD: General vs Chat) in the same registry change or immediately before.

### General / Chat mode

- **May author** `reef-widget` fences directly when interactive UI fits the conversation (calculators, forms, lightweight demos).
- Inherits the bulk of today’s `reef.full.md` **output contract**, **design system**, **template catalog**, and **`check_reef_widget`** workflow (possibly as a dedicated prompt part `tool-usage/reef-widgets.md` included only for `general` + `research` to avoid duplicating 200+ lines in two mode files).
- Tool policy: product decision in POLISH-019 (likely narrower than Build; must still allow `read_file` on `@minnow/reef/widgets/`, `check_reef_widget`, and widget-related tools).

### Research mode

- **May use** `reef-widget` for research **deliverables** (charts, comparison tables, timelines) embedded in the final report — relax the hard ban in `research.full.md`.
- Prefer **parent-authored** fences after synthesis, or **`spawn_sub_agent` `type: reef-widget`** when a visualization is the clearest deliverable (align with updated sub-agent policy).
- Keep read-only emphasis: no shell/git/write tools; widget bodies are presentation, not workspace mutation.

### Other modes (Build, Plan, Orchestrate)

- **No** direct Reef mode switch.
- Keep **`propose_mode_switch` / `reef_visualization`** → **`spawn_sub_agent` `reef-widget`** → paste fence (mounts in any mode).
- Update copy: remove “switch to Reef”; optional “Switch to **General** to iterate on widgets” only if user wants in-chat editing.

### Settings & model routing

- Move **Widget LLM** (provider/model on active chat: `reefWidgetProviderId`, `reefWidgetModelId`) out of Reef-only section:
  - **Option A (recommended):** One shared block under Settings → Modes → **General**, labeled “Inline widget LLM (General & Research)”.
  - **Option B:** Duplicate controls under General and Research (same chat fields; avoid drift with shared component).
- Model routing catalog: rename or regroup `'reef'` row to **`widget-llm`** / attach to General; keep binding fields on `Chat` unchanged for backward compatibility.

### Persistence migration

Mirror the existing **`debug` → `build`** pattern in `normalizeModeId()`:

```ts
// Proposed (exact target mode id follows POLISH-019)
if (value === 'reef') return 'general'; // or 'research' if chat metadata suggests research-only — default general
```

- **Do not** remove `'reef'` from `MODE_IDS` until one release after migration if external scripts depend on it; alternatively keep as deprecated alias in `isModeId` for one cycle. Prefer **normalize-only** (like `debug`) to avoid breaking raw JSON imports.
- Optional one-time rewrite in session load: scan all chats with `modeId === 'reef'`, set `general`, log count in dev console.

**Open product decision:** Default migration target `general` vs `research` vs user prompt on first open after upgrade.

---

## Out of scope (this polish item)

- Feature #04 durable **artifacts** (`~/.minnow/reef/artifacts/`) — update references from “Reef mode” to “General/Research” when #04 ships; not required for POLISH-020.
- Renaming **`reef-widget`** fence language or bridge `type: 'reef'` postMessage protocol (internal names stay).
- Removing template library or `src/chat/reef/` module layout.
- Changing sandbox/security model for iframes.

---

## Implementation plan (phased)

### Phase 0 — Decisions & POLISH-019 alignment

- [ ] **D0.1** Lock General mode id (`general` vs `chat`), label, tool policy, and default mode for migrated `reef` chats.
- [ ] **D0.2** Decide shared vs duplicated Reef prompt content (shared `tool-usage` fragment vs inline in two mode files).
- [ ] **D0.3** Decide Research: allow `spawn_sub_agent` `reef-widget` vs parent-only authoring.
- [ ] **D0.4** Decide Settings UX for widget LLM (Option A vs B above).

### Phase 1 — Registry, migration, server parity

- [ ] **P1.1** Add `general` to `ModeId`, `MODE_DEFINITIONS`, `server/config/validators.js`, tool enums in `definitions.ts`.
- [ ] **P1.2** Remove `reef` from `MODE_DEFINITIONS` / `listModes()`; extend `normalizeModeId('reef')` → `general` (or chosen target).
- [ ] **P1.3** Add `modes/general.{full,lite}.md` (POLISH-019 body + hook for Reef supplement).
- [ ] **P1.4** Deprecate or archive `modes/reef.{full,lite}.md` (keep files for diff reference until prompts migrated; remove from composer `promptId` map).

### Phase 2 — Prompt & handoff content

- [ ] **P2.1** Extract portable sections from `reef.full.md` into `tool-usage/reef-widgets.{full,lite}.md` (or `modes/_fragments/reef-authoring.md`) included when `mode` is `general` or `research`.
- [ ] **P2.2** Add Research-specific subsection: when to embed widgets in reports, citation rules, no workspace writes via widgets.
- [ ] **P2.3** Update `mode-handoff.md` / `mode-handoff.lite.md`: remove `set_chat_mode` to Reef; `reef_yes` → spawn sub-agent only; optional General switch for editing.
- [ ] **P2.4** Update `build.full.md`, `plan.full.md`, `orchestrate.full.md` (any “switch to Reef” strings).
- [ ] **P2.5** Update `research.full.md` sub-agent policy (allow controlled `reef-widget`).
- [ ] **P2.6** Update `prompt-composer.ts` `MODE_HANDOFF_MODE_IDS`: drop `reef`, add `general`.
- [ ] **P2.7** Update `src/skills/ask-user/SKILL.md` handoff table.

### Phase 3 — UI & settings

- [ ] **P3.1** `initModeSelector()` / segment order reflects new five modes (no Reef).
- [ ] **P3.2** Relocate `mountReefWidgetLlmSettings` from `id === 'reef'` to General (and Research if Option B).
- [ ] **P3.3** Model routing UI/catalog: remove or repoint `group: 'reef'`.
- [ ] **P3.4** `syncReefWidgetSettingsFromActiveChat()` — still runs on mode change (bindings are per-chat, not per-mode).

### Phase 4 — Tools & handoff code

- [ ] **P4.1** `HANDOFF_MODES` in `mode-handoff-tools.ts`: remove `reef`, add `general`.
- [ ] **P4.2** `buildProposeModeSwitchQuestions` `reef_visualization`: fix `reef_yes` description (no Reef mode switch).
- [ ] **P4.3** `executeSetChatMode` / `executeCreateChatWithMode` error strings and enum docs.
- [ ] **P4.4** `server/tools/plan-write-guard.js` and any `MODE_IDS` Set copies.

### Phase 5 — Tests & benchmarks

- [ ] **P5.1** Update `test/modes/test-helpers.mts` expected mode list (5 modes: build, plan, orchestrate, research, general).
- [ ] **P5.2** Replace `compose-mode` / `resolve-mode-prompt` reef cases with `general`.
- [ ] **P5.3** Reef widget tests: use `general` (or any mode) for `modeId` where author semantics matter; keep mount behavior tests mode-agnostic.
- [ ] **P5.4** `test/tools/mode-handoff-tools.test.mjs` — preset copy assertions.
- [ ] **P5.5** `test/prompts/mode-handoff-prompt.test.mjs` — no `set_chat_mode` to reef.
- [ ] **P5.6** `src/benchmark/suites/modes.ts` — drop or retarget `reef` probe to `general`.
- [ ] **P5.7** `test/chat/reef/reef-prompts-catalog.test.mjs` — catalog lives under shared fragment or general prompt.

### Phase 6 — Documentation

- [ ] **P6.1** [`documentation/context.md`](../../context.md) — five modes list, Reef section (runtime vs mode), handoff bullets.
- [ ] **P6.2** [`README.md`](../../../README.md), [`AGENTS.md`](../../../AGENTS.md).
- [ ] **P6.3** [`documentation/plans/references/mode-sources.md`](../references/mode-sources.md).
- [ ] **P6.4** [`documentation/plans/Build out/feature-04-reef-artifacts.md`](../Build%20out/feature-04-reef-artifacts.md) — replace “Reef mode” UI wording.
- [ ] **P6.5** [`documentation/plans/Build out/feature-18-headless-mode.md`](../Build%20out/feature-18-headless-mode.md) CLI `--mode` help if present.
- [ ] **P6.6** Mark POLISH-020 resolved in bug-hunt session doc when shipped.

---

## File touch matrix (implementation reference)

| Area | Primary files |
| --- | --- |
| Types / registry | `src/chat/modes/types.ts`, `registry.ts`, `server/config/validators.js` |
| General mode prompts | `src/chat/prompts/modes/general.{full,lite}.md` (new), `reef.{full,lite}.md` (deprecate) |
| Shared Reef authoring | `src/chat/prompts/tool-usage/reef-widgets.md` (new, suggested) |
| Composer | `src/chat/prompts/prompt-composer.ts` |
| Handoff | `src/chat/prompts/tool-usage/mode-handoff.md`, `src/tools/mode-handoff-tools.ts`, `src/tools/definitions.ts` |
| Mode UI | `src/ui/mode-selector.ts`, `src/ui/settings-sections.ts`, `src/ui/reef-widget-settings.ts` |
| Model routing | `src/settings/model-routing-catalog.ts`, `src/ui/settings-model-routing.ts` |
| Reef runtime | `src/chat/reef/widget-block-detector.ts` (comment only), rest unchanged |
| Tests | `test/modes/*`, `test/chat/reef/*`, `test/tools/mode-handoff-tools.test.mjs`, `test/prompts/mode-handoff-prompt.test.mjs` |
| Benchmark | `src/benchmark/suites/modes.ts` |
| Docs | `documentation/context.md`, `README.md`, `AGENTS.md` |

---

## Verification checklist (post-implementation)

1. **Mode picker** shows Build, Plan, Orchestrate, Research, General — no Reef.
2. **Load old session** with `modeId: "reef"` → opens as General (or chosen target); widgets in history still mount.
3. **General chat** can emit a valid `reef-widget` fence; `check_reef_widget` works; theme tokens apply.
4. **Research chat** can include a chart widget in a report per updated prompt (manual or scripted eval).
5. **Build + `propose_mode_switch` `reef_visualization`** → sub-agent fence **without** switching to removed Reef mode.
6. **Settings** widget LLM controls visible and persist `reefWidgetProviderId` / `reefWidgetModelId` on chat.
7. **`npm test`** — mode suites green; reef convention tests still pass.
8. **`npx tsc --noEmit`** clean.

---

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Users with muscle memory for Reef segment | Release note; one-time toast “Reef merged into General” (optional, out of scope unless requested) |
| Duplicated 200-line prompt in General + Research | Shared `tool-usage/reef-widgets` fragment |
| Research tool policy accidentally allows writes via widgets | Prompt + deny list unchanged for file/git tools |
| External scripts passing `modeId: reef` | Keep `normalizeModeId` alias indefinitely |
| Feature #04 plans reference Reef mode UI | Doc-only updates in Phase 6 |

---

## Sequencing recommendation

1. Land **POLISH-019** (`general` mode id, prompts, tool policy) in the same PR series or immediately before POLISH-020.
2. Land **POLISH-020** registry + migration + UI in one PR; prompt/handoff/test/doc follow-ups can split if review size demands.
3. Do **not** delete `reef.*.md` until shared fragment is wired and catalog tests point at the new source.

---

## Todos (plan tracker)

- [ ] Phase 0 — Product decisions (D0.1–D0.4)
- [ ] Phase 1 — Registry & migration (P1.1–P1.4)
- [ ] Phase 2 — Prompts & handoff copy (P2.1–P2.7)
- [ ] Phase 3 — UI & settings (P3.1–P3.4)
- [ ] Phase 4 — Tools & server guards (P4.1–P4.4)
- [ ] Phase 5 — Tests & benchmarks (P5.1–P5.7)
- [ ] Phase 6 — Documentation (P6.1–P6.6)
- [ ] Verification checklist (all eight items)

---

## References

- Bug hunt item: [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — POLISH-019, POLISH-020
- Architecture: [`documentation/context.md`](../../context.md) — Operating modes, Reef widgets
- Legacy Reef mode prompt: [`src/chat/prompts/modes/reef.full.md`](../../../src/chat/prompts/modes/reef.full.md)
- Mode handoff: [`documentation/plans/Build out/llm-mode-switch-suggestions.md`](../Build%20out/llm-mode-switch-suggestions.md) (if present) or `mode-handoff.md` source above


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-89](https://linear.app/minnowai/issue/MIN-89/polish-020-merge-reef-mode)
