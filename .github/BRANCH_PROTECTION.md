# Branch protection for `main`

The [`ci` workflow](workflows/ci.yml) must pass before merging pull requests.

## GitHub settings

1. Open **Settings → Branches → Branch protection rules** for `main`.
2. Enable **Require status checks to pass before merging**.
3. Add the required check: **`ci`** (job name: `typecheck + tests`).
4. Recommended: **Require branches to be up to date before merging**.

Both matrix lanes (`windows-latest` and `ubuntu-latest`) must be green; GitHub reports a single combined `ci` check when all jobs succeed.
