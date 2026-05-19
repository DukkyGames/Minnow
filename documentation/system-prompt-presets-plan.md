# System prompt presets

## Overview

Add a preset dropdown to the Settings drawer in `index.html` that loads curated system prompts into the existing textarea, tracks Custom vs preset selection, confirms before overwriting edited text, and persists choice + content in localStorage.

## Current behavior

SpeedChat is a single-page app in `index.html`. The system prompt lives in the settings drawer. On each send, the trimmed textarea value is prepended as a `system` message (not stored in `history`), so changing the prompt affects the next request only — no chat clear required.

Persistence: preset id and textarea text are stored under the key `speedchat.systemPrompt`. Other settings remain session-only.

## UX design

- Page load: restore from localStorage after populating the preset dropdown.
- User picks a preset: if the textarea differs from the last committed preset template (trim comparison), ask to confirm replacement; on cancel, revert the dropdown.
- User picks Custom: keep textarea as-is; mark selection as Custom.
- User edits textarea: if content no longer matches the active preset template, switch the dropdown to Custom.

## Preset list

Built-in presets (plus Custom): General assistant, Code assistant, LM Studio model tester, Inference benchmarking, TTFT stress test, Local RAG assistant, Structured output tester, Roleplay / character, Adversarial / jailbreak testing.

Roleplay preset retains `[CHARACTER NAME]` and `[brief description]` placeholders for the user to edit after applying.

## Implementation notes

- Data: `SYSTEM_PROMPT_PRESETS` array of `{ id, label, text }`.
- UI: `<select id="systemPromptPreset">` above `#systemPrompt` textarea; optional hint for roleplay placeholders.
- State: `activeSystemPromptPresetId` tracks the committed preset; empty string means Custom.
- `suppressSystemPromptSelectChange` prevents re-entrancy when reverting the select after cancel.

## Manual test plan

1. Open Settings — preset dropdown lists all presets and Custom.
2. Select TTFT stress test — textarea fills; sending a message should yield a first line `START` from the model when it follows instructions.
3. Edit textarea — select switches to Custom; reload — Custom and edited text restored.
4. Select another preset with edited textarea — confirm appears; Cancel keeps text; OK replaces text.
5. Select a preset, reload — same preset selected if text still matches template.
6. Clear system prompt, reload — empty Custom restored.

## Security note

The Adversarial / jailbreak testing preset is for local red-team evaluation with your own models.
