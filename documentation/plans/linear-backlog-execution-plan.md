# Linear backlog execution plan

**Created:** 2026-05-22  
**Team:** Minnow AI  
**Workflow per issue:** implement (sub-agent) → verify (sub-agent) → git commit (gitmoji) → push → Linear `Done`

## Excluded (not product work)

| ID | Reason |
| --- | --- |
| MIN-1–4 | Linear workspace onboarding templates (archived) |
| MIN-5–15, MIN-17–19, MIN-22, MIN-34 | Already **Done** |

## Execution order (open issues)

### Wave 1 — Orchestrate correctness (High, related)

| Order | ID | Title | Build plan / notes |
| --- | --- | --- | --- |
| 1 | MIN-35 | False red Stalled/Stopped when idle | `src/ui/orchestrate-board.ts`, watchdog |
| 2 | MIN-36 | Aggregate token stats parent + sub-agents | stats strip / `lastStats` |
| 3 | MIN-18 | Plan mode writes enforced server-side | `server.js` `/api/tools` |

### Wave 2 — Quick maintenance & docs

| Order | ID | Title |
| --- | --- | --- |
| 4 | MIN-29 | Fix mojibake in `context.md` |
| 5 | MIN-23 | Refresh `context.md` counts/tests/SW |
| 6 | MIN-25 | Archive `scripts/_extracted-app.js` |
| 7 | MIN-26 | SW stale `index.html` after deploy |
| 8 | MIN-30 | Expose max tool turns in settings |

### Wave 3 — UI / attachments / Reef

| Order | ID | Title |
| --- | --- | --- |
| 9 | MIN-28 | Chat title thinking leak sanitization |
| 10 | MIN-31 | Uploads show file chip not raw text |
| 11 | MIN-33 | Reef widget auto-size + error check + all modes display |
| 12 | MIN-21 | Reef postMessage origin hardening |
| 13 | MIN-32 | Excel / additional file types |

### Wave 4 — Quality & perf

| Order | ID | Title |
| --- | --- | --- |
| 14 | MIN-27 | Runtime tool-list permission sync tests |
| 15 | MIN-20 | Bundle size / code-split |
| 16 | MIN-24 | Markdown preview default for `.md` |

### Wave 5 — Large product (roadmap features, dependency order)

Foundation first, then observability, then plugins/headless:

| Order | ID | Feature # | Slug |
| --- | --- | --- | --- |
| 17 | MIN-37 | #01 | trace-replay |
| 18 | MIN-38 | #02 | model-routing formalize |
| 19 | MIN-39 | #03 | context-budgets |
| 20 | MIN-45 | #09 | sampler-presets |
| 21 | MIN-43 | #07 | sub-agent-budgets |
| 22 | MIN-41 | #05 | interrupt-steer |
| 23 | MIN-42 | #06 | approval-patterns |
| 24 | MIN-44 | #08 | tool-result-cache |
| 25 | MIN-46 | #10 | constrained-decoding |
| 26 | MIN-48 | #11 | model-capability-detection |
| 27 | MIN-47 | #12 | prompt-diffing |
| 28 | MIN-49 | #13 | prompt-profiles |
| 29 | MIN-50 | #14 | cost-token-observability |
| 30 | MIN-51 | #15 | agent-activity-view |
| 31 | MIN-40 | #04 | reef-artifacts |
| 32 | MIN-52 | #16 | agent-pack-plugin |
| 33 | MIN-53 | #17 | tool-plugin |
| 34 | MIN-54 | #18 | headless-mode |
| 35 | MIN-55 | #19 | determinism-mode |
| 36 | MIN-56 | #20 | multi-model-conversation |
| 37 | MIN-57 | #21 | local-eval-harness |
| 38 | MIN-58 | #22 | project-scoped-configs |

### Wave 6 — Epic (defer until waves 1–5 stable)

| ID | Title | Note |
| --- | --- | --- |
| MIN-16 | Bug Tracker mode | New composer mode + kanban — multi-sprint |

## Todos

- [x] Wave 1 complete (MIN-35, MIN-36, MIN-18)
- [x] Wave 2 complete (MIN-25, MIN-26, MIN-29, MIN-23, MIN-30)
- [x] Wave 3 complete (MIN-28, MIN-31, MIN-33, MIN-21)
- [x] Wave 4 partial (MIN-27, MIN-24)
- [ ] Wave 4 remaining (MIN-20 bundle size)
- [x] Wave 3 remaining (MIN-32 file types)
- [ ] Wave 5 (MIN-37–MIN-58 roadmap features — multi-sprint)
- [ ] MIN-16 Bug Tracker mode (epic)
