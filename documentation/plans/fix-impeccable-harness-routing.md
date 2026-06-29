# Fix Impeccable harness routing

Living plan for bringing Minnow `/impeccable <command>` harness commands to parity with [Impeccable getting started](https://impeccable.style/tutorials/getting-started/) (v3.x).

**Status:** Planned (not yet implemented)

See also: [fix_impeccable_harness plan in Cursor](.cursor/plans/fix_impeccable_harness_ac96c59d.plan.md) for full implementation detail.

---

## Goal

Every **harness command** must work when the user types `/impeccable <cmd> [target]` in Minnow chat — the agent receives actionable workflow markdown (no broken `{{tokens}}`), upstream routing rules, and Minnow tool bindings. Harness commands must **not** be invoked via `npx impeccable <cmd>` or `run_impeccable` (except `detect` / `live`, which are spawnable).

---

## Harness vs non-harness (Minnow contract)

| Class | Commands | How it must work in Minnow |
|-------|----------|----------------------------|
| **Harness** | All 23 workflow commands below | `/impeccable <cmd>` → inject `reference/<cmd>.md` + prerequisites into skill body |
| **Harness aliases** | `teach` → `init` | Parser resolves to `init.md` |
| **Harness prerequisites** | `craft` → also `shape.md` | Injected as `## Prerequisite workflow: shape` |
| **CLI** | `detect` | `run_impeccable` or `npm run impeccable:detect` only |
| **Bundled script** | `live` | `run_impeccable` with `command: live` (script wins over harness text for spawn) |
| **Management** | `pin`, `unpin` | Harness workflow in upstream SKILL; Minnow writes `~/.minnow/skills/<cmd>/` shortcuts |

---

## Harness command matrix (definition of done)

After implementation, each row must pass its acceptance check.

| Command | Reference file | Acceptance (harness path) |
|---------|----------------|---------------------------|
| `init` | `init.md` | `/impeccable init` injects init workflow; `teach` alias works |
| `craft` | `craft.md` + `shape.md` | Both sections present; shape interview before code |
| `shape` | `shape.md` | Injected; uses `ask_question` not raw `{{ask_instruction}}` |
| `document` | `document.md` | Injected; context via `load_impeccable_context` |
| `extract` | `extract.md` | Injected |
| `critique` | `critique.md` | Injected |
| `audit` | `audit.md` | Injected |
| `polish` | `polish.md` | Injected (tutorial happy path) |
| `bolder` | `bolder.md` | Injected |
| `quieter` | `quieter.md` | Injected |
| `distill` | `distill.md` | Injected |
| `harden` | `harden.md` | Injected |
| `onboard` | `onboard.md` | Injected |
| `animate` | `animate.md` | Injected |
| `colorize` | `colorize.md` | Injected |
| `typeset` | `typeset.md` | Injected |
| `layout` | `layout.md` | Injected |
| `delight` | `delight.md` | Injected |
| `overdrive` | `overdrive.md` | Injected |
| `clarify` | `clarify.md` | Injected |
| `adapt` | `adapt.md` | Injected |
| `optimize` | `optimize.md` | Injected |
| `live` | `live.md` | Injected on send; spawn via `run_impeccable` when agent runs script |

**Non-harness references** (`brand.md`, `product.md`, `typography.md`, etc.) are loaded by workflow steps inside harness refs — not slash-routable. Upstream SKILL setup step 4 handles register refs.

**General invocation** (`/impeccable redo the hero`): no sub-command match → upstream SKILL routing rules (from composed `SKILL.upstream.md`) apply; no reference file injection.

**Bare `/impeccable`**: composed skill body includes command menu from `command-metadata.json` (and optionally v3 context signals later).

---

## Harness send path (target architecture)

```mermaid
sequenceDiagram
  participant User
  participant Loop as loop.ts
  participant Compose as composeImpeccableSkillBody
  participant API as GET reference/:cmd
  participant Agent

  User->>Loop: /impeccable polish sidebar
  Loop->>Loop: parseSlashCommand → skillId impeccable, userText polish sidebar
  Loop->>Compose: skill body + userText
  Compose->>Compose: Minnow addendum + SKILL.upstream.md
  Compose->>API: fetch polish.md
  API-->>Compose: patched reference content
  Compose-->>Loop: full skill body with Active command section
  Loop->>Agent: system prompt + load_impeccable_context available
```

---

## Implementation phases (harness-first)

### Phase A — Single source of truth for harness commands

1. After v3 sync, derive `HARNESS_COMMANDS` from upstream `pin.mjs` `VALID_COMMANDS` + `init` (not hand-maintained duplicate lists).
2. Export shared **`command-aliases.ts`** / `command-aliases.js`: `{ teach: 'init' }`.
3. Client (`impeccable-client.ts`) and server (`command-routing.js`, `reference-handler.js`) both use aliases before lookup.
4. `command-metadata.json` is the whitelist for client parse; server rejects unknown refs consistently.

### Phase B — Patched references (harness workflows executable)

1. Post-sync patch **every** `reference/<harness-cmd>.md` — no `{{…}}` left.
2. Rewrite context loading lines to **`load_impeccable_context` tool** first.
3. Rewrite `{{ask_instruction}}` → **`ask_question` tool**.
4. Add regression test: loop all harness commands, assert `readImpeccableReference(appRoot, cmd)` returns content without `{{`.

### Phase C — Composed skill body (routing rules for all harness sends)

1. `composeImpeccableSkillBody()` merges Minnow addendum + patched `SKILL.upstream.md` + injected refs.
2. Replace direct `augmentImpeccableSkillBody` calls in `loop.ts`.
3. Bare `/impeccable` gets static menu block.

### Phase D — Mistaken harness calls to `run_impeccable`

Keep `harnessCommandGuidanceWithReference` but resolve aliases (`teach` → `init.md`). Agent still gets full workflow if it calls the tool by mistake.

### Phase E — Harness parity beyond `/impeccable`

1. `/ui-designer` + sub-command text → same reference injection.
2. Pin creates `~/.minnow/skills/<cmd>/SKILL.md` redirect stubs.

### Phase F — Harness test matrix

New file `test/impeccable/harness-commands.test.mjs`:

- For each harness command in `VALID_COMMANDS`: parse subcommand, API returns 200, content has no `{{`, includes command-specific anchor (e.g. polish → "Pre-Polish", init → "PRODUCT.md").
- `craft` → `commandsForImpeccableAugment` includes `shape`.
- `teach` parses as `init`.

---

## Manual harness smoke (required before done)

```
/impeccable init
/impeccable polish settings page
/impeccable audit #app
/impeccable craft new feature panel
/impeccable critique sidebar
/impeccable
```

For each: confirm system/skill body contains `## Active Impeccable command: <cmd>` (or command menu for bare), zero `{{scripts_path}}`, and agent uses `load_impeccable_context` not `npx impeccable <cmd>`.

---

## Out of scope (this plan)

- Live mode browser HMR polish (spawn path only; harness `live.md` injection in scope)
- Replicating upstream Cursor pre-edit hooks
- Auto-running `context-signals.mjs` on every bare `/impeccable` (phase 2 optional)
