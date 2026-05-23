# Fix Impeccable harness vs CLI routing

**Status:** Implemented (2026-05-23)

## Problem

Minnow routed harness commands (`teach`, `audit`, `shape`, …) through `npx impeccable <cmd>`, but the upstream CLI only exposes `detect` and `skills`. Users saw install errors and the model concluded `teach` was unavailable.

## Solution

| Class | Examples | Mechanism |
|-------|----------|-----------|
| **Harness** | `teach`, `audit`, `shape`, `craft`, `polish`, … | `/impeccable <cmd>` auto-injects `src/skills/impeccable/reference/<cmd>.md` into the skill body |
| **CLI** | `detect` | `run_impeccable` → `npx impeccable detect` |
| **Script** | `live` | `run_impeccable` → `node src/skills/impeccable/scripts/live.mjs` |

## Code

| Module | Role |
|--------|------|
| `server/impeccable/command-routing.js` | `HARNESS_COMMANDS`, `parseImpeccableSubcommand`, `harnessCommandGuidance` |
| `server/impeccable/reference-handler.js` | `readReferenceContent`, `GET /api/skills/impeccable/reference/:command` |
| `server/impeccable/run-impeccable.js` | Harness → guidance; `detect` / `live` only spawn |
| `src/skills/impeccable-client.ts` | `augmentImpeccableSkillBody` (client fetch + append) |

## Tests

- `npm run test:impeccable` — parse, run_impeccable, reference API
- `npm run test:skills-impeccable` — Step 14 built-in skill
- `tsx --test test/skills/impeccable-client.test.mts` — slash augmentation
- `node scripts/step15-smoke.mjs` — teach harness check + detect

## Verification

1. `/impeccable teach` — system prompt includes `reference/teach.md`; no `npx impeccable teach`.
2. `run_impeccable({ command: 'teach' })` — harness guidance string, no subprocess.
3. `run_impeccable({ command: 'detect' })` — CLI scan still works when `npx` is available.
