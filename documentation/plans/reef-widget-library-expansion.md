# Reef widget library expansion

**Status:** Implemented (templates, snippets, prompts, tests, verification checklist).

**Goal:** Expand the Reef mode widget catalog from 7 to 15 full templates plus 6 composable snippets, and update reef prompts so the LLM knows when to use templates vs snippets. No server or iframe pipeline changes—only new markdown under `src/chat/reef/widgets/` and prompt table updates.

**Non-goals:** No changes to `server/reef/widget-paths.js`, `widget-block-detector.ts`, `widget-iframe.ts`, `widget-prelude.ts`, or `widget-baseline-styles.ts`. New files are served via `@minnow/reef/widgets/<name>.md`.

---

## Delivered inventory

### Full templates (15)

| File | Stack | Notes |
|------|-------|-------|
| `calculator.md` | Vanilla | Original |
| `calculator-with-chart.md` | React + Recharts | Original |
| `slider-graph.md` | React + Recharts | Original |
| `tabs.md` | Vanilla | Original |
| `form.md` | Vanilla | Original; `sendPrompt` |
| `data-table.md` | Vanilla | Original |
| `comparison.md` | Vanilla | Original |
| `checklist.md` | Vanilla | Add/toggle/remove items |
| `stats-dashboard.md` | Vanilla | KPI grid |
| `pie-chart.md` | React + Recharts | Donut/pie + `requestResize` |
| `heatmap.md` | Vanilla | Calendar grid |
| `quiz.md` | Vanilla | Multi-step quiz |
| `qa-callllm.md` | Vanilla | `callLLM` + `onChunk` streaming |
| `timeline.md` | Vanilla | Vertical steps |
| `unit-converter.md` | Vanilla | Category tabs + units |

### Snippets (6)

| File | Purpose |
|------|---------|
| `snippet-chart-line.md` | Recharts line chart in `.rw-chart` |
| `snippet-chart-bar.md` | Recharts bar chart |
| `snippet-table.md` | Sortable table fragment |
| `snippet-stat-card.md` | Single KPI card |
| `snippet-input-row.md` | Label + input + validation hint |
| `snippet-sparkline.md` | SVG sparkline for stat cards |

---

## Prompt updates

- **`src/chat/prompts/modes/reef.full.md`:** Templates table (15 rows) + `### Snippets` subsection with `snippet-*.md` discovery and six paths.
- **`src/chat/prompts/modes/reef.lite.md`:** One line: snippets as `snippet-*.md` alongside full templates.

---

## Conventions

| Rule | Detail |
|------|--------|
| File shape | Description above fence; single ` ```reef-widget `; order: `<style>` → markup → `<script>` last |
| Tokens only | `--bg`, `--surface`, `--text`, `--accent`, etc. — no hex |
| Layout | `max-width: 680px`, 0.5px borders, weights 400/500 |
| Charts | `.rw-chart` + pixel height; `requestResize()` after layout |
| Snippets | No `<h2>` title chrome; customization bullets in markdown |

---

## Verification

| Step | Command / action |
|------|------------------|
| Automated | `npm test` — `test/chat/reef/widget-templates-conventions.test.mjs`, `widget-snippets-conventions.test.mjs`, `reef-prompts-catalog.test.mjs` |
| Build | `npm run build` |
| Manual | [`documentation/plans/verification/feature-reef.md`](verification/feature-reef.md) — per-template rows, snippet compose, `qa-callllm` streaming |

---

## Implementation todos

- [x] Vanilla widgets: checklist, timeline, unit-converter, quiz, heatmap, stats-dashboard
- [x] React: pie-chart
- [x] Six snippet-*.md files
- [x] qa-callllm with callLLM onChunk streaming
- [x] npm test / build (reef suites green; 2 pre-existing UI failures elsewhere)
- [ ] Manual Reef render in light/dark — see feature-reef.md items 13–22 (human QA)
- [x] reef.full.md + reef.lite.md catalog
- [x] context.md, this plan, feature-reef checklist
- [x] reef-prompts-catalog.test.mjs
