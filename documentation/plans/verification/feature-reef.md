# Reef mode — verification checklist

Manual QA after shipping Reef mode widgets. Automated gate: `npm run build` && `npm test` (includes `test/chat/reef/*.test.mts`, `test/modes/*` with `reef`).

## Checklist

1. **Mode selector** — Reef appears as the fifth segment; status pill reads `Mode: Reef`.
2. **Prompt** — Ask `what mode are you in?` — assistant describes Reef / widgets.
3. **Widget render** — Ask for a tip calculator — closed `reef-widget` fence becomes an interactive iframe; theme tracks light/dark toggle.
4. **sendPrompt** — Widget button calls `sendPrompt('…')` — composer fills; message does **not** auto-send.
5. **callLLM** — Widget using `callLLM` streams text into the widget.
6. **Override model** — Set Reef widget LLM in composer strip to a different model than chat; `callLLM` uses override (network tab / logs).
7. **Default fallback** — Clear override — widget uses chat `providerId` / `modelId`.
8. **Sandbox** — DevTools in iframe: `localStorage` throws; disallowed fetch blocked by CSP.
9. **Streaming** — While tokens stream, each `reef-widget` block shows pending labels (Building widget… / Styling… / Finishing up…) with a loading dot row, not highlighted code. After the reply completes, the fence becomes an interactive iframe without duplicate mounts on debounce.
10. **Template** — Ask for standard slider-graph; model reads `src/chat/reef/widgets/slider-graph.md` and mounts.
10a. **React** — Recharts + slider widget renders via importmap.
11. **Impeccable** — Polish request references impeccable workflow.
12. **Other modes** — Build/Plan/Orchestrate/Research: `reef-widget` fences stay code blocks only.

### Widget library expansion (15 templates + 6 snippets)

13. **checklist** — Add/toggle/remove items; footer shows completed count; light/dark readable.
14. **stats-dashboard** — KPI grid uses surface + text tokens; no hex palette.
15. **pie-chart** — Recharts donut/pie; value edits reflow chart; `requestResize` keeps iframe height sane.
16. **heatmap** — Calendar grid; hover/tooltip readable in both themes.
17. **quiz** — Multi-step flow; score/result on finish; Restart works.
18. **timeline** — Vertical rail; active step uses `--accent`.
19. **unit-converter** — Category switch; live conversion; long unit labels do not break grid.
20. **qa-callllm** — Ask streams via `callLLM` + `onChunk` into output panel; **Send to chat** fills composer only (no auto-send); disable Ask while in-flight.
21. **Snippet compose** — e.g. “Build a sales dashboard using line chart and stat card snippets” — model reads `snippet-chart-line.md` + `snippet-stat-card.md` and merges one fence with shared tokens.
22. **Prompt catalog** — `reef.full.md` lists all 15 template paths + Snippets table; `reef.lite.md` mentions `snippet-*.md` (automated: `reef-prompts-catalog.test.mjs`).

## Automated coverage

| Area | Tests |
|------|--------|
| Mode prompts | `test/modes/load-mode-prompt.test.mts`, `compose-mode.test.mts` |
| Reef prompt catalog | `test/chat/reef/reef-prompts-catalog.test.mjs` |
| Widget templates / snippets | `test/chat/reef/widget-templates-conventions.test.mjs`, `widget-snippets-conventions.test.mjs` |
| Chat shape | `test/modes/chat-mode-persist.test.mts` (reef LLM fields) |
| Reef host | `test/chat/reef/theme-forward.test.mts`, `widget-iframe.test.mts`, `widget-block-detector.test.mts`, `widget-pending-ui.test.mts`, `widget-bridge.test.mts` |
