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
9. **Streaming** — Open fence shows as code; on close, swaps to iframe without duplicate mounts on debounce.
10. **Template** — Ask for standard slider-graph; model reads `src/chat/reef/widgets/slider-graph.md` and mounts.
10a. **React** — Recharts + slider widget renders via importmap.
11. **Impeccable** — Polish request references impeccable workflow.
12. **Other modes** — Build/Plan/Orchestrate/Research: `reef-widget` fences stay code blocks only.

## Automated coverage

| Area | Tests |
|------|--------|
| Mode prompts | `test/modes/load-mode-prompt.test.mts`, `compose-mode.test.mts` |
| Chat shape | `test/modes/chat-mode-persist.test.mts` (reef LLM fields) |
| Reef host | `test/chat/reef/theme-forward.test.mts`, `widget-iframe.test.mts`, `widget-block-detector.test.mts`, `widget-bridge.test.mts` |
