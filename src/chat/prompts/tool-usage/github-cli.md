---
id: github-cli
kind: tool-usage
label: GitHub CLI (gh)
version: 1
part: tool-usage
description: Prefer gh over browser or web fetch for this repo's GitHub forge data.
---

## GitHub — use `gh`, not github.com in the browser

When the workspace remote is on **GitHub** (typical `origin` → `github.com`), use the **GitHub CLI** through `execute_command` for forge operations. Do **not** open github.com with `browser_*`, and do **not** use `fetch_web_content` / `web_search` / `rag_web_content` to scrape GitHub pages that `gh` can answer.

### Use `gh` for

- **Pull requests** — `gh pr list`, `gh pr view`, `gh pr create`, `gh pr merge`, `gh pr diff`, `gh pr checkout`
- **Issues** — `gh issue list`, `gh issue view`, `gh issue create`, comments
- **CI / Actions** — `gh run list`, `gh run view`, `gh pr checks`, `gh run watch`
- **Repo metadata** — `gh repo view`, `gh release list`, compare links via `gh api` when needed

Auth is the user's **`gh auth login`** session on the machine. Minnow does not store GitHub tokens; Source Control Center and issue PR actions use the same CLI.

### Still use web tools for

- Third-party documentation, blogs, and pages outside this repo's authenticated forge API
- Public discussion on **other** repositories when the user did not ask about the current workspace remote

### When `gh` is unavailable

If `gh --version` or the command fails with not installed / not logged in, say so plainly and suggest `gh auth login`. Do **not** treat scraping github.com as an acceptable substitute for missing `gh`.
