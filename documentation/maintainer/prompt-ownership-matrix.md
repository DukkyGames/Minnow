# Prompt ownership matrix (MIN-379)

Defines which layer owns which instruction so composed system prompts do not repeat the same rule 2–4 times.

## Layers

| Layer | Owns | Does not own |
|-------|------|----------------|
| **base** | Identity, session context, communication style, safety/trust (destructive commands, secrets, untrusted data), resource awareness | Tool mechanics, mode workflow, deliverable schemas |
| **tool-usage (default)** | Read-before-write, never-invent-output, shell/Windows/build-output/background commands, parallel calls, failure policy (interactive vs autonomous), working directory | Mode-specific deliverables, plan schemas |
| **tool-usage (fragments)** | Conditional features: fact-verification ladder, mode-handoff, ask-question enforcement, browser allowlist, sub-agent delegation, Context7, settings, launch-app | Content duplicated in base or mode |
| **mode** | Mode mechanics only: tool policy deltas, handoff triggers, mode-specific reporting (e.g. READY FOR VERIFICATION), `todo_write` when no default work-agent | Full implementation how-to when default work-agent is active |
| **work-agent** | Deliverable spec: Builder persistence/diagnostics, Planner plan schema, Orchestrator board workflow | Base safety, generic shell rules |
| **memory** | Brain wiki layout, routing table, save_memory / brain_write rules, brain-before-web | Base one-line pointer to memory section |

## Suppression rules (composer)

When `workAgentId` matches `defaultForModes` for the active mode, the **mode** part is omitted — the work-agent carries deliverable instructions (e.g. Build + Builder, Plan + Planner, Orchestrate + Orchestrator).

## Dedupe checklist

- Security/git destructive rules: **base** + **tool-usage rule 7** only (mode/work-agent reference base).
- Verify-before-build ladder: **fact-verification fragment** only (base = one-line pointer).
- `ask_question` mandatory usage: **ask-question-enforcement** (+ browser allowlist when browser tools enabled).
- Memory save/search rules: **memory part** only (base = one-line pointer).
- Shell/Windows/test guidance: **tool-usage default** only.
- Plan schema with Build/Test/Accept: **planner work-agent** when auto-selected; **plan mode** when planner is not active.

## Lite profile

Every fragment that can be injected in lite profile must ship a `.lite.md` variant. Parts without a lite variant are **omitted** (not truncated mid-sentence).

## Compose-time hygiene

- HTML comments (`<!-- MINNOW_MODE_MARKER: … -->`) are stripped before the model sees the prompt.
- Dead interpolation tokens are removed from the composer.
