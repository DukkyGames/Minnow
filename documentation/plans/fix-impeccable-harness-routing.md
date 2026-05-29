# Fix Impeccable harness routing

## Problem

Agents invoking `/impeccable craft` called `run_impeccable` with `command: shape` because upstream `craft.md` Step 1 said “Run impeccable shape”. The tool accepted harness names but only returned a short guidance string (no `shape.md` body), blocking the craft flow.

## Solution

| Layer | Change |
|-------|--------|
| Client injection | `augmentImpeccableSkillBody` appends `shape.md` when primary command is `craft` |
| `run_impeccable` | Spawnable commands limited to `detect` and `live`; mistaken harness calls return guidance **plus** full `reference/<cmd>.md` |
| Sync preserves | `scripts/impeccable-preserves/apply-minnow-patches.mjs` substitutes `{{command_prefix}}` → `/` and patches craft Step 1 after `impeccable:sync` |

## Key files

- [`src/skills/impeccable-client.ts`](../../src/skills/impeccable-client.ts) — `HARNESS_PREREQUISITE_COMMANDS`, `commandsForImpeccableAugment`
- [`server/impeccable/command-routing.js`](../../server/impeccable/command-routing.js) — `harnessCommandGuidanceWithReference`, narrowed `listAcceptedRunImpeccableCommands`
- [`server/impeccable/run-impeccable.js`](../../server/impeccable/run-impeccable.js)
- [`scripts/sync-impeccable-skill.mjs`](../../scripts/sync-impeccable-skill.mjs)

## Verification

```bash
npm run test:impeccable
```

Manual:

1. Send `/impeccable craft …` in composer with `npm start`.
2. Confirm system prompt includes `Active Impeccable command: craft` and `Prerequisite workflow: shape`.
3. Agent should run shape interview in chat without `run_impeccable({ command: 'shape' })`.
4. `/impeccable audit` injects audit only; `run_impeccable` with `detect` still runs CLI.
