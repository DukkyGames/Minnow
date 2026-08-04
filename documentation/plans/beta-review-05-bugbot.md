# Pre-beta Bugbot review — supplement

**Note:** [Bugbot branch code review](34fc8a89-fea3-45f2-b903-0a948313a02b) exited immediately because **`Diff: branch changes` was empty** at review time. Use the primary code report plus this supplement for defect-oriented handoff.

**Primary report:** [beta-review-01-code-architecture.md](./beta-review-01-code-architecture.md) (IDs **BETA-001** through **BETA-016**).

---

## Defect-first summary (branch / working tree)

From git status at review time: modified `README.md`, `server/product-wiki/catalog.json`, `server/settings/registry-manifest.json`, `src/skills/builtin-manifest.json`, and skills library index JSON files. Tests agent reported failures aligned with **manifest drift** (`skills-probes`, editor AI meta, fake LSP).

| ID | Sev | Defect | Fix |
|----|-----|--------|-----|
| BUG-001 | P0 | `npm test` failures on dirty tree | Regenerate manifests via `npm run build` / prebuild; commit or revert; green CI |
| BUG-002 | P1 | Onboarding teaches hidden apps | See BETA-001 |
| BUG-003 | P1 | Experts UI/settings leak | See BETA-004, UI-Experts |
| BUG-004 | P2 | Notification targets email app when hidden | BETA-008 |
| BUG-005 | P2 | Legacy `#/benchmark` etc. hash flash | BETA-006 |
| BUG-006 | P3 | `reef-widget` usage labels | BETA-012 |

---

## Re-run Bugbot

Stage **product** changes only (prompts, manifests, `src/`, `documentation/manual/`) — not `test/fixtures/**` from local test runs — then:

```
Task subagent_type=bugbot
Diff: uncommitted changes
```
