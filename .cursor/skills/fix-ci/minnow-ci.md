# Minnow CI reference

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

## CI job: `typecheck + tests`

Matrix: `windows-latest`, `ubuntu-latest` (Node 24).

| Step | Command | Local repro |
|------|---------|-------------|
| Install | `npm ci` | `npm ci` |
| Test discovery | `npm run test:check-coverage` | same |
| Uicons registry | `npm run check:icons` | same |
| Typecheck | `npx tsc --noEmit` | same |
| Test suite | `npm test` | same |

**Full local gate** (matches CI order):

```bash
npm run test:check-coverage && npm run check:icons && npx tsc --noEmit && npm test
```

## Scoped test suites

From `package.json` — use when logs show a specific suite/file:

| Suite | Command |
|-------|---------|
| memory | `npm run test:memory` |
| brain | `npm run test:brain` |
| lsp | `npm run test:lsp` |
| mcp | `npm run test:mcp` |
| skills | `npm run test:skills` |
| engine | `npm run test:engine` |
| board | `npm run test:board` |
| settings | `npm run test:settings` |
| browser | `npm run test:browser` |

Discover suites: `node test/run-all.mjs --help` or read [`test/run-all.mjs`](../../test/run-all.mjs).

## Common Minnow CI failure patterns

| Symptom | Likely cause |
|---------|----------------|
| `check-test-coverage` / missing test file | New `test/**/*.test.*` not wired in coverage manifest |
| `tsc` errors | Strict TS; fix types, don't `@ts-ignore` without reason |
| Windows-only path failures | Use `path.join`, forward slashes in tests, or `fileURLToPath` |
| SQLite `.db-wal` fixture churn | Prefer not committing WAL/SHM unless test requires fresh DB |
| `check:icons` | Run `npm run check:icons` locally; sync icons via documented scripts |
| Flaky timing in board/browser tests | Check Electron/PTY availability; may be environment-specific |

## Docs to update after substantive fixes

- [`documentation/context.md`](../../documentation/context.md) — architecture/API/storage changes
- [`AGENTS.md`](../../AGENTS.md) — agent-facing conventions if behavior changed
