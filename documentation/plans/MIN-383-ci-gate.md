# MIN-383 — CI gate: typecheck + test suite

## Problem

No CI enforced `tsc --noEmit` or `npm test` on PRs. The hand-maintained `npm test` glob list silently skipped new test files.

## Solution

1. **`test/run-all.mjs`** — discovers `test/**/*.test.{js,mjs,mts,ts}`, assigns runners via `test/test-config.mjs`, batches execution (chunked for Windows command-line limits).
2. **`test/check-test-coverage.mjs`** — fails when any discoverable test file has no runner (orphan detection).
3. **`.github/workflows/ci.yml`** — `npm ci`, `test:check-coverage`, `tsc --noEmit`, `npm test` on `windows-latest` + `ubuntu-latest`.
4. **Branch protection** — document in `.github/BRANCH_PROTECTION.md`; enable `ci` required check on `main` in GitHub Settings.

## Todos

- [x] Test discovery driver + config map
- [x] Orphan test detection script
- [x] Replace package.json glob monster
- [x] GitHub Actions workflow (Windows + Ubuntu)
- [x] Update AGENTS.md, commands.md, context.md
- [ ] Enable branch protection on `main` (repo admin)

## Acceptance

- PR with type error or failing test cannot merge (once branch protection enabled)
- New `test/foo/bar.test.mts` runs with zero package.json edits
- Orphan-test detection fails CI when a file is not covered
- CI caches npm via `actions/setup-node` cache
