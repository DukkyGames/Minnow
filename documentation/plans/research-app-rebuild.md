# Deep Research App Rebuild (shipped)

Rebuilt the Deep Research panel to match the MinnowOS handoff prototype while keeping the live `/api/research/*` backend.

## What changed

- **UI shell:** `#researchView` uses `.dr-*` layout (tabs, centered 760px column, engine settings footer).
- **Progress:** Replaced SVG synapse with 5-phase stepper + live source feed (`src/research/progress-panel.ts`).
- **Results:** Structured in-app brief parsed from markdown (`parse-brief.ts`, `report-view.ts`).
- **Library:** 2-column card grid with compact toolbar; overflow menu preserves archive/delete/report/discuss/refine.
- **Categories:** `technical` / `academic` / `news` / `market` / `general` (engine + UI); legacy `product`/`comparison`/`howto`/`factcheck` normalized on read.
- **OS:** `noteAgentMessage` on completion; concierge seed triggers auto-run.

## Key files

| Area | Path |
|------|------|
| Orchestrator | `src/research/panel.ts` |
| Progress | `src/research/progress-panel.ts` |
| Report | `src/research/parse-brief.ts`, `src/research/report-view.ts` |
| Library | `src/research/library.ts` |
| Styles | `src/styles/research-page.css` |
| Markup | `index.html` (`#researchView`) |
| Categories | `server/research/prompts.js`, `src/research/categories.ts` |

## Removed

- `src/research/synapse.ts`
- `test/ui/research-synapse.test.mts`

## Tests

- `test/ui/research-page-html.test.mjs`
- `test/ui/research-panel.test.mts`
- `test/ui/research-library.test.mts`
- `test/research/progress-panel.test.mts`
- `test/research/parse-brief.test.mts`
