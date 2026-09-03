---
name: pr-review-button
overview: Add a Review PR button on Issues and Source Control that runs a dedicated pr-reviewer sub-agent and renders a shared in-app review (verdict, findings, merge/fix/update actions).
todos:
  - id: phase1-agent
    content: "pr-reviewer sub-agent: prompts, shipped map, sub-agents.json, minnow.pr-review.v1 schema"
    status: completed
  - id: phase2-core
    content: "Review core: pr-review-target, context, run-pr-review, review-actions (shared merge)"
    status: completed
  - id: phase3-store
    content: "pr-review-store + /api/config/reviews (paths, middleware, home scaffold, api-client)"
    status: completed
  - id: phase4-panel
    content: "Shared renderer + pr-review.css (verdict, findings, actions, live running state)"
    status: completed
  - id: phase5-scc
    content: "Source Control: Review PR button, Review section, branch pre-select, pr.review command"
    status: completed
  - id: phase6-issues
    content: "Issues: resolveIssuePrNumber, Review PR button, Review section, agent-watch prNumber write"
    status: completed
  - id: tests-docs
    content: "Unit tests (target, context, schema, panel) + context.md and manual updates"
    status: completed
isProject: false
---

# Review PR button + dedicated reviewer agent

In-app PR review from Issues and Source Control. No `gh pr review` / `gh pr comment`. Reviews persist in `~/.minnow/reviews/state.json`.

## Locked shape

- Dedicated `pr-reviewer` sub-agent in its own background chat (`modeId: build`). Chat appears in the sidebar; **do not focus it** (MIN-637).
- Shared renderer on both surfaces. Restrained `--mn-*` chrome. Severity is never colour-only.
- Reviewer allowlist includes `execute_command` so large PRs can `git diff <base>...<head> -- <path>`.
- Board-finished watcher writes `agent.prNumber` / `prUrl`.
- Verdict derived: any `blocker` → `REQUEST_CHANGES`; `warn` only → `NEEDS_DISCUSSION`; neither → `APPROVE`.

## Architecture

```
Issues detail ─┐                                    ┌─ pr-review-store (~/.minnow/reviews/state.json)
               ├─► startPrReview({cwd, repo, number, issueId?})
SCC PR detail ─┘         │                          └─ pr-review-panel.ts (shared renderer)
                         ├─ fetchPrReviewContext → prView + prDiff
                         ├─ ensureBackgroundChat  key `pr-review:<repo>#<n>`
                         └─ spawnSubAgent type 'pr-reviewer', category 'research'
```
