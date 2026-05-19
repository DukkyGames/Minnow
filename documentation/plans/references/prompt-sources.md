# Prompt design references — adoption notes (Step 04)

SpeedChat’s programmatic prompt system is **inspired by** several open products; **no vendor prompts were copied verbatim**. This document records what we adopted vs diverged.

## [system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)

**Adopted:** Separate concerns for persona/role, tool rules, and task-specific “info” presets; short, testable preset ids exposed in settings.

**Diverged:** Single concatenated `system` message (not multiple system roles); dual-root overrides under `~/.speedchat/prompts/`; Full/Lite/Custom profiles with explicit lite caps; tool list only in the `tool-usage` part.

## [OpenCode](https://github.com/anomalyco/opencode) / [docs](https://opencode.ai/docs/)

**Adopted:** Layered composition (base → mode → agent/expert → tools → injectable context); named config files on disk; forward-compatible stubs for modes, work-agents, and skills.

**Diverged:** SpeedChat uses LM Studio locally (not OpenCode’s CLI stack); `prompt-configs/*.json` schema is SpeedChat-specific; no agent spawn in Step 04 — only compose-time hooks.

## [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)

**Adopted:** Lite profile with shorter bodies, disabled optional layers (`info`, `memory`), compact `{{enabled_tools}}` (ids only, max 12), and unit-test ratio target (lite ≤ 40% of full length by character proxy).

**Diverged:** Lite rules are part of `prompt-composer.ts` with per-part char caps, not a separate trimming pipeline; shipped `*.lite.md` and `liteBody` front matter live beside full files.

## Cursor (conceptual)

**Adopted:** Per-part enable/disable in Custom profiles; separate editable bodies per profile (Full/Lite/Custom) planned for Step 20 settings UI.

**Diverged:** Engine ships in Step 04 without settings tabs; DOM `#systemPrompt` remains a legacy fallback until Step 20; composed prompt is source of truth on send.

## Current SpeedChat (`constants.ts` / settings)

**Adopted:** `SYSTEM_PROMPT_PRESETS` ids migrated to `src/chat/prompts/info/*.full.md`; `system-prompt.json` / preset select unchanged for UI.

**Diverged:** Send path uses `composeSystemPrompt()` instead of textarea-only; `activeInfoPresetId` in `config.json` drives the `info` part.
