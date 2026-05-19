---
name: impeccable
description: Design, critique, audit, and refine SpeedChat UI using PRODUCT.md, DESIGN.md, and .impeccable/design.json. Not for backend-only tasks.
disable-model-invocation: true
---

# Impeccable (SpeedChat)

Design and iterate SpeedChat’s frontend using **project context files** and vendored Impeccable command references. Do not invent product facts or duplicate token tables from memory.

**UI Designer (Step 15)** may invoke this skill automatically for critique → shape → implement flows.

## Context gate (required before UI edits)

Load full product + design context in one JSON blob (no `head` / `grep` / `jq` on output):

```bash
node src/skills/impeccable/scripts/speedchat-context.mjs
```

Or upstream loader only:

```bash
node src/skills/impeccable/scripts/load-context.mjs
```

Set `IMPECCABLE_CONTEXT_DIR` to the repo root (default) or a monorepo sub-app path.

| File | Role |
|------|------|
| `PRODUCT.md` | Users, register (`product`), tone, anti-references |
| `DESIGN.md` | Human design spec (Bench Instrument north star) |
| `.impeccable/design.json` | Structured tokens (`schemaVersion: 2`) for critique/document |
| `src/styles/tokens.css` | Runtime CSS variables — edit tokens here, not hardcoded hex in components |
| `index.html`, `src/styles/*.css`, `src/ui/**` | Implementation targets |

When implementing or critiquing components, read **`.impeccable/design.json`** for machine-readable roles and bindings.

## Command routing

User may append a sub-command after `/impeccable` (e.g. `/impeccable polish sidebar`). **Load the matching reference** under `src/skills/impeccable/reference/` before acting:

| Sub-command | Reference |
|-------------|-----------|
| `audit`, `critique` | `reference/audit.md`, `reference/critique.md` |
| `shape`, `craft`, `polish` | `reference/shape.md`, `reference/craft.md`, `reference/polish.md` |
| `teach`, `document`, `extract` | `reference/teach.md`, `reference/document.md`, `reference/extract.md` |
| `live` | `reference/live.md` (needs dev server + HMR; limited in static-only workflows) |

Full upstream command list: see `SKILL.upstream.md` or https://impeccable.style/docs

Run anti-pattern scan when asked or before large UI PRs:

```bash
npm run impeccable:detect
```

## SpeedChat constraints (see DESIGN.md)

- **Register:** `product` in `PRODUCT.md` — tool UI, not marketing site.
- **Aesthetic:** Bench instrument — calm surfaces, ink accent, soft green user bubbles; no hero-metric cards or gradient text.
- **Typography:** JetBrains Mono for code/metrics; respect `DESIGN.md` scale.
- **Motion:** Subtle; honor `prefers-reduced-motion`.
- **Anti-patterns:** Follow `DESIGN.md` and `npm run impeccable:detect`; do not restate full OKLCH tables here.

## Tools

- Read-only: `read_file`, `list_directory` on paths above.
- Optional: SpeedChat browser CDP tools for visual QA (Step 12).
- CLI: `npx impeccable detect …` via `npm run impeccable:detect`.

## Maintenance

- Upstream `reference/` + `scripts/` sync: `npm run impeccable:sync`
- Update upstream + re-sync: `npm run impeccable:update`
- User override: `~/.speedchat/skills/impeccable/SKILL.md` replaces this built-in when `name: impeccable` matches.
