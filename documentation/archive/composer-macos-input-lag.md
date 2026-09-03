# Composer typing lag on macOS

## Status

Done (second pass).

## Problem

Typing lagged, especially **backspace after a pause**, then caught up if typing continued. That is idle main-thread work, not per-keystroke layout:

1. **300ms session save** — `handleComposerDraftInput` called `scheduleSaveSessions` on every key. After a pause, `saveSessionsNow` JSON-serialized the dirty chat (full history) and, in DEV, every chat for the dirty-tracking verifier.
2. **450ms context ring** — composer `input` called `getContextBudget`, which re-tokenizes history + prompt. Deletes pause more often, so they hit this hitch.
3. **macOS spellcheck** — native checking runs after a pause on the textarea.

The first pass (field-sizing, no textarea transitions, ligature override) was necessary but not sufficient.

## Todos

- [x] Grow the composer with CSS `field-sizing: content` so Electron 43 does not run JS height math per key
- [x] Keep a JS `autoResize` fallback that skips `height: auto` unless the box must shrink
- [x] Disable CSS transitions on text-entry controls; override `optimizeLegibility` on composer fields
- [x] Coalesce draft persistence after paint; skip slash-picker work when `/` is not in play
- [x] Cover the no-reflow fast path in tests; note the path in `documentation/context.md`
- [x] Do not PATCH sessions on composer keystrokes — idle 2.5s / blur / chat switch / send
- [x] Do not re-tokenize context history on composer input; skip scheduled ring refresh while typing
- [x] `spellcheck="false"` on Code and Chat composer textareas
