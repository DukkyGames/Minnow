# Comment cleanup

**Status:** Done · **Date:** 2026-09-01

Strip long Claude-style comments from first-party code. Keep the code easy for a junior to scan: names do the work; comments mark sections and the rare non-obvious function.

## Rules

- No comments **inside** functions, except compiler/linter directives (`@ts-expect-error`, `eslint-disable`, `prettier-ignore`).
- If a function needs a note, **one short line** immediately above it. Plain English. No essays, no phase codes (`P9-F`).
- In **`.js` files**, keep JSDoc **type** tags (`@param`, `@returns`, `@typedef`, `@type`). Drop the prose around them.
- In **`.ts` / `.d.ts` files**, drop JSDoc that only repeats types.
- Large files get **section banners** so you can find a block fast. Format: `// ── Label ` then `─` padded to **80 characters**. Module level only. Short label (1–4 words). Example: [`src/ui/scc-refs.ts`](../../src/ui/scc-refs.ts).
- Do not touch vendored / generated trees: `node_modules`, `dist`, `src/skills/impeccable`, `.agents/skills`.

## Todos

- [x] Clean `server/orchestrator`
- [x] Clean `server/runner` and `server/sub-agents`
- [x] Clean remaining `server/`
- [x] Clean `src/orchestrator` and `src/agents`
- [x] Clean `src/chat`, `src/api`, `src/tools`
- [x] Clean `src/ui`
- [x] Clean remaining `src/`
- [x] Clean `electron/`, first-party `scripts/`, and `test/`
- [x] Add 80-character `// ── Label` section banners on large files
- [x] Document the convention in `documentation/context.md`
